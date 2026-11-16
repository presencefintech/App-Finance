'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui/card';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';
import { AttachmentUploader, type UploadedAttachment } from '@/components/attachment-uploader';
import { MoneyInput } from '@/components/money';
import { formatMoney } from '@/lib/money';

interface Account { id: string; name: string; type: 'CASH' | 'BANK'; currency: 'USD' | 'CDF'; balance: string }
interface Threshold { currency: 'USD' | 'CDF'; minAmount: string | null }
interface Category { id: string; name: string; kind: 'INCOME' | 'EXPENSE'; isActive: boolean }
const METHODS = [
  ['CASH', 'Espèces'], ['BANK_TRANSFER', 'Virement'], ['CHEQUE', 'Chèque'], ['MOBILE_MONEY', 'Mobile money'], ['OTHER', 'Autre'],
] as const;

/** Formulaire de recette ou de dépense directe ; devise imposée par le compte choisi. */
export function OperationForm({ kind, entities }: { kind: 'income' | 'expense'; entities: { id: string; name: string }[] }) {
  const router = useRouter();
  const [entityId, setEntityId] = useState(entities[0]?.id ?? '');
  const [form, setForm] = useState({ accountId: '', categoryId: '', party: '', detail: '', amount: '', paymentMethod: 'CASH' });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [files, setFiles] = useState<UploadedAttachment[]>([]);

  const accounts = useQuery({ queryKey: ['accounts', entityId], queryFn: () => api<{ data: Account[] }>(`/accounts?entityId=${entityId}`) });
  const categories = useQuery({ queryKey: ['categories', entityId], queryFn: () => api<{ data: Category[] }>(`/categories?entityId=${entityId}`) });
  const thresholds = useQuery({ queryKey: ['evidence-thresholds', entityId], queryFn: () => api<{ data: Threshold[] }>(`/evidence-thresholds?entityId=${entityId}`) });
  const account = accounts.data?.data.find((a) => a.id === form.accountId);
  const cats = categories.data?.data.filter((c) => c.isActive && c.kind === (kind === 'income' ? 'INCOME' : 'EXPENSE')) ?? [];

  // Comparaison décimale sans number JS : on aligne les parties entières puis on compare les chaînes.
  const dec = (v: string) => { const [i = '0', f = ''] = v.split('.'); return `${i.padStart(18, '0')}.${f.padEnd(2, '0')}`; };
  const minAmount = thresholds.data?.data.find((t) => t.currency === account?.currency)?.minAmount ?? null;
  const evidenceRequired = Boolean(minAmount && form.amount && dec(form.amount) >= dec(minAmount));

  const save = useMutation({
    mutationFn: () =>
      api(kind === 'income' ? '/incomes' : '/expenses', {
        method: 'POST',
        body: {
          entityId, accountId: form.accountId, categoryId: form.categoryId, amount: form.amount,
          currency: account?.currency, paymentMethod: form.paymentMethod, attachmentIds: files.map((f) => f.id),
          ...(kind === 'income' ? { source: form.party, note: form.detail || undefined } : { beneficiary: form.party, purpose: form.detail }),
        },
      }),
    onSuccess: () => { setForm((f) => ({ ...f, party: '', detail: '', amount: '' })); setFiles([]); router.refresh(); },
  });

  return (
    <Card>
      <CardTitle>{kind === 'income' ? 'Nouvelle recette' : 'Nouvelle dépense'}</CardTitle>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid max-w-3xl gap-x-4 sm:grid-cols-2">
        {entities.length > 1 && (
          <Field label="Entité">
            <select className={inputClass} value={entityId} onChange={(e) => { setEntityId(e.target.value); setFiles([]); setForm((f) => ({ ...f, accountId: '', categoryId: '' })); }}>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>
        )}
        <Field label={kind === 'income' ? 'Compte qui reçoit' : 'Compte payeur'}>
          <select required className={inputClass} value={form.accountId} onChange={(e) => {
            const a = accounts.data?.data.find((x) => x.id === e.target.value);
            setForm((f) => ({ ...f, accountId: e.target.value, paymentMethod: a?.type === 'CASH' ? 'CASH' : f.paymentMethod === 'CASH' ? 'BANK_TRANSFER' : f.paymentMethod }));
          }}>
            <option value="">Choisir…</option>
            {accounts.data?.data.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency}) — {formatMoney(a.balance, a.currency)}</option>)}
          </select>
        </Field>
        <Field label="Catégorie">
          <select required className={inputClass} value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">Choisir…</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Mode">
          <select className={inputClass} value={form.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)} disabled={account?.type === 'CASH'}>
            {METHODS.filter(([v]) => (account?.type === 'CASH' ? v === 'CASH' : account?.type === 'BANK' ? v !== 'CASH' : true)).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label={kind === 'income' ? 'Origine / source' : 'Bénéficiaire'}>
          <input required className={inputClass} value={form.party} onChange={(e) => set('party', e.target.value)} />
        </Field>
        <Field label="Montant">
          <MoneyInput required currency={account?.currency ?? 'USD'} value={form.amount} onChange={(v) => set('amount', v)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label={kind === 'income' ? 'Note (optionnel)' : 'Motif'}>
            <input required={kind === 'expense'} className={inputClass} value={form.detail} onChange={(e) => set('detail', e.target.value)} />
          </Field>
          <div className="mb-3">
            <p className="mb-1 text-sm font-medium">
              Justificatif {evidenceRequired ? <span className="text-danger">(obligatoire à partir de {formatMoney(minAmount!, account!.currency)})</span> : <span className="text-muted">(facultatif{minAmount && account ? ` — obligatoire à partir de ${formatMoney(minAmount, account.currency)}` : ''})</span>}
            </p>
            <ul className="mb-2 text-sm">
              {files.map((f) => (
                <li key={f.id} className="flex items-center gap-2">
                  <span>{f.fileName}</span>
                  <button type="button" className="text-xs text-muted underline" onClick={() => setFiles((l) => l.filter((x) => x.id !== f.id))}>Retirer</button>
                </li>
              ))}
            </ul>
            {files.length < 5 && (
              <AttachmentUploader
                targetType="draft" targetId={entityId} kind={kind === 'income' ? 'RECEIPT' : 'INVOICE'}
                label={files.length ? 'Ajouter un autre justificatif' : 'Joindre une facture / un justificatif (photo ou PDF)'}
                onUploaded={(a) => setFiles((l) => [...l, a])}
              />
            )}
          </div>
          <ErrorText>{save.error?.message}</ErrorText>
          <Button type="submit" disabled={save.isPending || !account || (evidenceRequired && files.length === 0)}>Enregistrer</Button>
        </div>
      </form>
    </Card>
  );
}
