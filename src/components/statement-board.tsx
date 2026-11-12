'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui/card';
import { Button, ErrorText, inputClass } from '@/components/ui/form';
import { StatusBadge } from '@/components/ui/status-badge';
import { Money } from '@/components/money';
import { ChartCard } from '@/components/charts/chart-card';
import { DonutChart } from '@/components/charts/donut-chart';
import { useStepUp } from '@/components/providers';
import { formatDate } from '@/lib/format';

type Currency = 'USD' | 'CDF';
interface EntryV { id: string; date: string; reference: string; description: string; amount: string }
interface LineV {
  id: string; date: string; label: string; reference: string | null; amount: string; status: 'UNMATCHED' | 'SUGGESTED' | 'MATCHED' | 'IGNORED' | 'CREATED';
  confidence: number | null; preselectedEntryId: string | null; matchedEntry: EntryV | null; candidates: EntryV[];
  amountDiffEntry: EntryV | null; duplicateOfId: string | null; note: string | null;
}
interface Statement {
  id: string; accountName: string; currency: Currency; status: 'IN_PROGRESS' | 'SUBMITTED' | 'VALIDATED'; fileName: string; periodStart: string; periodEnd: string;
  submittedById: string | null; validationNote: string | null;
  columns: { matched: LineV[]; unrecorded: LineV[]; missingFromStatement: EntryV[]; amountDifferences: LineV[]; duplicates: LineV[] };
  reconciliation: { statementOpening: string; statementClosing: string; ledgerBalance: string; outstandingEntries: string; unrecordedStatementLines: string; difference: string; balanced: boolean };
}

function useRefresh() {
  const router = useRouter();
  return () => router.refresh();
}

function LineActions({ s, l, incomeCategories, editable }: { s: Statement; l: LineV; incomeCategories: { id: string; name: string }[]; editable: boolean }) {
  const refresh = useRefresh();
  const [entryId, setEntryId] = useState(l.preselectedEntryId ?? l.candidates[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState(incomeCategories[0]?.id ?? '');
  const [ignoring, setIgnoring] = useState(false);
  const [note, setNote] = useState('');
  const call = useMutation({
    mutationFn: (v: { action: string; body?: unknown }) => api(`/bank-statements/${s.id}/lines/${l.id}/${v.action}`, { method: 'POST', body: v.body ?? {} }),
    onSuccess: refresh,
  });
  if (!editable) return null;

  return (
    <div className="mt-2 flex flex-col gap-2">
      <ErrorText>{call.error?.message}</ErrorText>
      {l.status === 'SUGGESTED' && (
        <div className="flex flex-wrap items-center gap-2">
          {l.candidates.length > 1 && (
            <select className={`${inputClass} w-auto`} value={entryId} onChange={(e) => setEntryId(e.target.value)}>
              {l.candidates.map((c) => <option key={c.id} value={c.id}>{c.reference} · {formatDate(c.date)}</option>)}
            </select>
          )}
          <Button disabled={call.isPending || !entryId} onClick={() => call.mutate({ action: 'confirm', body: { entryId } })}>Confirmer</Button>
          <Button variant="ghost" onClick={() => call.mutate({ action: 'unmatch' })}>Écarter</Button>
        </div>
      )}
      {l.status === 'MATCHED' && <Button variant="ghost" onClick={() => call.mutate({ action: 'unmatch' })}>Annuler le rapprochement</Button>}
      {(l.status === 'UNMATCHED' || l.status === 'IGNORED') && (
        <div className="flex flex-wrap items-center gap-2">
          {Number(l.amount) > 0 && (
            <select className={`${inputClass} w-auto`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {incomeCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {l.status === 'UNMATCHED' && (
            <Button disabled={call.isPending} onClick={() => call.mutate({ action: 'create-transaction', body: { categoryId: Number(l.amount) > 0 ? categoryId : undefined } })}>
              {Number(l.amount) < 0 ? 'Créer les frais bancaires' : 'Créer la recette'}
            </Button>
          )}
          {ignoring ? (
            <>
              <input className={`${inputClass} w-48`} placeholder="Motif" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button variant="ghost" disabled={note.trim().length < 3} onClick={() => call.mutate({ action: 'ignore', body: { note } })}>OK</Button>
            </>
          ) : l.status === 'UNMATCHED' ? <Button variant="ghost" onClick={() => setIgnoring(true)}>Ignorer</Button> : <Button variant="ghost" onClick={() => call.mutate({ action: 'unmatch' })}>Rouvrir</Button>}
        </div>
      )}
    </div>
  );
}

function LineCard({ s, l, incomeCategories, editable }: { s: Statement; l: LineV; incomeCategories: { id: string; name: string }[]; editable: boolean }) {
  return (
    <li className="rounded-xl border border-border p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{l.label}</div>
          <div className="text-xs text-muted">{formatDate(l.date)}{l.reference ? ` · ${l.reference}` : ''}</div>
        </div>
        <Money value={l.amount} currency={s.currency} className="shrink-0 font-semibold" />
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {l.status === 'SUGGESTED' && <StatusBadge tone="warning">Suggéré {l.confidence} %{l.preselectedEntryId ? ' · pré-coché' : ''}</StatusBadge>}
        {l.status === 'MATCHED' && <StatusBadge tone="success">Rapproché</StatusBadge>}
        {l.status === 'CREATED' && <StatusBadge tone="success">Créé depuis le relevé</StatusBadge>}
        {l.status === 'IGNORED' && <StatusBadge>Ignoré</StatusBadge>}
        {l.duplicateOfId && <StatusBadge tone="danger">Doublon possible</StatusBadge>}
      </div>
      {l.matchedEntry && <div className="mt-1 text-xs text-muted">↔ {l.matchedEntry.reference} · {l.matchedEntry.description}</div>}
      {l.status === 'SUGGESTED' && l.candidates.map((c) => (
        <div key={c.id} className="mt-1 text-xs text-muted">? {c.reference} · {formatDate(c.date)} · {c.description}</div>
      ))}
      {l.amountDiffEntry && (
        <div className="mt-1 text-xs text-danger">Écart : écriture {l.amountDiffEntry.reference} à <Money value={l.amountDiffEntry.amount} currency={s.currency} /> — corrigez par contre-passation puis ressaisie.</div>
      )}
      {l.note && <div className="mt-1 text-xs text-muted">« {l.note} »</div>}
      <LineActions s={s} l={l} incomeCategories={incomeCategories} editable={editable} />
    </li>
  );
}

export function StatementBoard({ statement: s, incomeCategories, currentUserId }: { statement: Statement; incomeCategories: { id: string; name: string }[]; currentUserId: string }) {
  const refresh = useRefresh();
  const withStepUp = useStepUp();
  const [note, setNote] = useState('');
  const editable = s.status === 'IN_PROGRESS';
  const r = s.reconciliation;

  const auto = useMutation({ mutationFn: () => api<{ suggested: number; preselected: number }>(`/bank-statements/${s.id}/auto-match`, { method: 'POST' }), onSuccess: refresh });
  const submit = useMutation({ mutationFn: () => api(`/bank-statements/${s.id}/submit`, { method: 'POST' }), onSuccess: refresh });
  const validate = useMutation({
    mutationFn: () => withStepUp(() => api(`/bank-statements/${s.id}/validate`, { method: 'POST', body: { note: note || undefined } })),
    onSuccess: refresh,
  });
  const pdfHref = `/api/v1/bank-statements/${s.id}/report?format=pdf`;
  const allLines = [...new Map([...s.columns.matched, ...s.columns.unrecorded, ...s.columns.amountDifferences].map((l) => [l.id, l])).values()];
  const countBy = (...st: LineV['status'][]) => allLines.filter((l) => st.includes(l.status)).length;
  const progress = [
    { name: 'Rapprochées', value: countBy('MATCHED', 'CREATED'), color: 'var(--series-1)' },
    { name: 'À confirmer', value: countBy('SUGGESTED'), color: 'var(--series-4)' },
    { name: 'Non rapprochées', value: countBy('UNMATCHED'), color: 'var(--series-2)' },
    { name: 'Ignorées', value: countBy('IGNORED'), color: 'var(--series-other)' },
  ];

  return (
    <div className="grid gap-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{s.accountName}</h1>
            <p className="text-sm text-muted">{s.fileName} · {formatDate(s.periodStart)} → {formatDate(s.periodEnd)}</p>
          </div>
          <StatusBadge tone={s.status === 'VALIDATED' ? 'success' : 'warning'}>{s.status === 'IN_PROGRESS' ? 'En cours' : s.status === 'SUBMITTED' ? 'Soumis' : 'Validé'}</StatusBadge>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
          <div><dt className="text-xs text-muted">Solde du relevé</dt><dd><Money value={r.statementClosing} currency={s.currency} className="font-semibold" /></dd></div>
          <div><dt className="text-xs text-muted">Solde comptable</dt><dd><Money value={r.ledgerBalance} currency={s.currency} className="font-semibold" /></dd></div>
          <div><dt className="text-xs text-muted">Écritures en suspens</dt><dd><Money value={r.outstandingEntries} currency={s.currency} /></dd></div>
          <div><dt className="text-xs text-muted">Lignes du relevé non enregistrées</dt><dd><Money value={r.unrecordedStatementLines} currency={s.currency} /></dd></div>
          <div><dt className="text-xs text-muted">Écart final</dt><dd><Money value={r.difference} currency={s.currency} className={`font-semibold ${r.balanced ? 'text-primary' : 'text-danger'}`} /></dd></div>
        </dl>
        <ErrorText>{auto.error?.message ?? submit.error?.message ?? validate.error?.message}</ErrorText>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {editable && <Button onClick={() => auto.mutate()} disabled={auto.isPending}>Lancer les suggestions</Button>}
          {editable && <Button variant="ghost" onClick={() => submit.mutate()} disabled={submit.isPending}>Soumettre</Button>}
          {s.status === 'SUBMITTED' && s.submittedById !== currentUserId && (
            <>
              {!r.balanced && <input className={`${inputClass} w-72`} placeholder="Note d’acceptation de l’écart (obligatoire)" value={note} onChange={(e) => setNote(e.target.value)} />}
              <Button onClick={() => validate.mutate()} disabled={validate.isPending}>Valider le rapprochement</Button>
            </>
          )}
          {s.status === 'SUBMITTED' && s.submittedById === currentUserId && <span className="text-sm text-muted">En attente de validation par une autre personne.</span>}
          <a href={pdfHref} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-background">État de rapprochement (PDF)</a>
        </div>
        {auto.data && <p className="mt-2 text-xs text-muted">{auto.data.suggested} suggestion(s), dont {auto.data.preselected} pré-cochée(s). Rien n’est confirmé sans votre validation.</p>}
        {s.validationNote && <p className="mt-2 text-sm text-muted">Note : « {s.validationNote} »</p>}
      </Card>

      <ChartCard title="Avancement du rapprochement" subtitle="Lignes du relevé par état" table={{ columns: ['État', 'Lignes'], rows: progress.map((p) => [p.name, p.value]) }}>
        <DonutChart label="Avancement du rapprochement" unit="count" items={progress} centerValue={`${progress.find((p) => p.name === 'Rapprochées')?.value ?? 0}/${allLines.length}`} centerLabel="rapprochées" />
      </ChartCard>

      <div className="grid gap-4 xl:grid-cols-4">
        <Card>
          <CardTitle>Correspondances ({s.columns.matched.length})</CardTitle>
          <ul className="grid gap-2">{s.columns.matched.map((l) => <LineCard key={l.id} s={s} l={l} incomeCategories={incomeCategories} editable={editable} />)}</ul>
        </Card>
        <Card>
          <CardTitle>Non enregistrées ({s.columns.unrecorded.length})</CardTitle>
          <p className="mb-2 text-xs text-muted">Lignes du relevé sans écriture : frais bancaires, versements non saisis…</p>
          <ul className="grid gap-2">{s.columns.unrecorded.map((l) => <LineCard key={l.id} s={s} l={l} incomeCategories={incomeCategories} editable={editable} />)}</ul>
        </Card>
        <Card>
          <CardTitle>Absentes du relevé ({s.columns.missingFromStatement.length})</CardTitle>
          <p className="mb-2 text-xs text-muted">Écritures du grand livre que la banque n’a pas (encore) traitées.</p>
          <ul className="grid gap-2">
            {s.columns.missingFromStatement.map((e) => (
              <li key={e.id} className="rounded-xl border border-border p-3 text-sm">
                <div className="flex justify-between gap-2"><span className="truncate">{e.description}</span><Money value={e.amount} currency={s.currency} className="shrink-0 font-semibold" /></div>
                <div className="text-xs text-muted">{formatDate(e.date)} · {e.reference}</div>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle>Écarts de montant ({s.columns.amountDifferences.length})</CardTitle>
          <p className="mb-2 text-xs text-muted">Même référence, montant différent.</p>
          <ul className="grid gap-2">{s.columns.amountDifferences.map((l) => <LineCard key={l.id} s={s} l={l} incomeCategories={incomeCategories} editable={editable} />)}</ul>
        </Card>
      </div>
    </div>
  );
}
