'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui/card';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';

interface Preview { rowCount: number; firstRow: string[]; sample: string[][]; savedMapping: Mapping | null }
interface Mapping { hasHeader: boolean; date: number; label: number; reference?: number; amount?: number; debit?: number; credit?: number }

async function post<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { method: 'POST', body: form, headers: { 'Idempotency-Key': crypto.randomUUID() } });
  const body = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string; details?: unknown } }) | null;
  if (!res.ok) throw new ApiError(body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? 'Erreur', res.status);
  return body as T;
}

type ColKey = 'date' | 'label' | 'reference' | 'amount' | 'debit' | 'credit';

function ColumnSelect({ k, label, optional, cols, mapping, onChange }: {
  k: ColKey; label: string; optional?: boolean; cols: string[]; mapping: Mapping; onChange: (m: Mapping) => void;
}) {
  return (
    <Field label={label}>
      <select className={inputClass} value={mapping[k] ?? ''} onChange={(e) => onChange({ ...mapping, [k]: e.target.value === '' ? undefined : Number(e.target.value) })}>
        {optional && <option value="">— aucune —</option>}
        {cols.map((c, i) => <option key={i} value={i}>{i + 1}. {mapping.hasHeader ? c : `Colonne ${i + 1}`}</option>)}
      </select>
    </Field>
  );
}

const guess = (header: string[], re: RegExp) => { const i = header.findIndex((h) => re.test(h)); return i >= 0 ? i : undefined; };

/** Import en deux étapes : aperçu + choix des colonnes (mémorisé par banque), puis création du relevé. */
export function StatementImport({ accounts }: { accounts: { id: string; name: string }[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<'signed' | 'split'>('split');
  const [m, setM] = useState<Mapping>({ hasHeader: true, date: 0, label: 1 });
  const [balances, setBalances] = useState({ opening: '', closing: '' });

  const doPreview = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.set('file', file!); form.set('accountId', accountId);
      return post<Preview>('/bank-statements/preview', form);
    },
    onSuccess: (p) => {
      setPreview(p);
      const saved = p.savedMapping;
      if (saved) { setM(saved); setMode(saved.amount !== undefined ? 'signed' : 'split'); return; }
      const h = p.firstRow.map((x) => x.toLowerCase());
      const amount = guess(h, /montant|amount/);
      setMode(amount !== undefined ? 'signed' : 'split');
      setM({
        hasHeader: true, date: guess(h, /date/) ?? 0, label: guess(h, /libell|label|description|d[ée]tail/) ?? 1,
        reference: guess(h, /r[ée]f/), amount, debit: guess(h, /d[ée]bit|retrait/), credit: guess(h, /cr[ée]dit|d[ée]p[ôo]t|versement/),
      });
    },
  });

  const doImport = useMutation({
    mutationFn: () => {
      const form = new FormData();
      const mapping = mode === 'signed' ? { hasHeader: m.hasHeader, date: m.date, label: m.label, reference: m.reference, amount: m.amount } : { hasHeader: m.hasHeader, date: m.date, label: m.label, reference: m.reference, debit: m.debit, credit: m.credit };
      form.set('file', file!); form.set('accountId', accountId); form.set('mapping', JSON.stringify(mapping));
      form.set('openingBalance', balances.opening); form.set('closingBalance', balances.closing);
      return post<{ id: string }>('/bank-statements', form);
    },
    onSuccess: (r) => router.push(`/rapprochements/${r.id}`),
  });

  const cols = preview?.firstRow ?? [];
  const select = (k: ColKey, label: string, optional?: boolean) => (
    <ColumnSelect key={k} k={k} label={label} optional={optional} cols={cols} mapping={m} onChange={setM} />
  );

  return (
    <Card>
      <CardTitle>Importer un relevé bancaire</CardTitle>
      <div className="grid max-w-3xl gap-x-4 sm:grid-cols-2">
        <Field label="Compte bancaire">
          <select className={inputClass} value={accountId} onChange={(e) => { setAccountId(e.target.value); setPreview(null); }}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Fichier (CSV ou Excel .xlsx)">
          <input type="file" accept=".csv,.txt,.xlsx" className={inputClass} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
        </Field>
      </div>
      <ErrorText>{doPreview.error?.message}</ErrorText>
      <Button disabled={!file || !accountId || doPreview.isPending} onClick={() => doPreview.mutate()}>Lire le fichier</Button>

      {preview && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold">Aperçu ({preview.rowCount} lignes)</h3>
          <div className="mb-4 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <tbody>{preview.sample.map((r, i) => <tr key={i} className={i === 0 && m.hasHeader ? 'bg-background font-medium' : ''}>{r.map((c, j) => <td key={j} className="whitespace-nowrap px-2 py-1">{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {preview.savedMapping && <p className="mb-3 text-xs text-primary">Colonnes mémorisées pour cette banque — vérifiez-les.</p>}
          <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={m.hasHeader} onChange={(e) => setM({ ...m, hasHeader: e.target.checked })} /> La première ligne est un en-tête</label>
          <div className="grid max-w-3xl gap-x-4 sm:grid-cols-3">
            {select('date', 'Date')}{select('label', 'Libellé')}{select('reference', 'Référence', true)}
          </div>
          <div className="mb-3 flex gap-4 text-sm">
            <label><input type="radio" checked={mode === 'split'} onChange={() => setMode('split')} /> Colonnes débit / crédit</label>
            <label><input type="radio" checked={mode === 'signed'} onChange={() => setMode('signed')} /> Montant signé (une colonne)</label>
          </div>
          <div className="grid max-w-3xl gap-x-4 sm:grid-cols-3">
            {mode === 'signed' ? select('amount', 'Montant') : <>{select('debit', 'Débit', true)}{select('credit', 'Crédit', true)}</>}
          </div>
          <div className="grid max-w-3xl gap-x-4 sm:grid-cols-2">
            <Field label="Solde d’ouverture du relevé" hint="Tel qu’imprimé par la banque (peut être négatif)">
              <input className={inputClass} inputMode="decimal" value={balances.opening} onChange={(e) => setBalances({ ...balances, opening: e.target.value.replace(',', '.') })} />
            </Field>
            <Field label="Solde de clôture du relevé">
              <input className={inputClass} inputMode="decimal" value={balances.closing} onChange={(e) => setBalances({ ...balances, closing: e.target.value.replace(',', '.') })} />
            </Field>
          </div>
          <ErrorText>{doImport.error?.message}</ErrorText>
          <Button disabled={doImport.isPending || !balances.opening || !balances.closing} onClick={() => doImport.mutate()}>Importer le relevé</Button>
        </div>
      )}
    </Card>
  );
}
