'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui/card';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';
import { MoneyInput } from '@/components/money';

interface Account { id: string; name: string; entityId: string; currency: 'USD' | 'CDF'; isActive: boolean }

/** Avance manuelle : l'entité prêteuse a payé une dépense de l'autre entité (contrôleuse uniquement). */
export function AdvanceForm({ lenderEntities, entities }: { lenderEntities: { id: string; name: string }[]; entities: { id: string; name: string }[] }) {
  const router = useRouter();
  const [lenderEntityId, setLenderEntityId] = useState(lenderEntities[0]?.id ?? '');
  const [f, setF] = useState({ lenderAccountId: '', amount: '', beneficiary: '', purpose: '' });
  const accounts = useQuery({ queryKey: ['accounts', 'all'], queryFn: () => api<{ data: Account[] }>('/accounts') });
  const mine = accounts.data?.data.filter((a) => a.entityId === lenderEntityId && a.isActive) ?? [];
  const lenderAccount = mine.find((a) => a.id === f.lenderAccountId);
  const borrowers = entities.filter((e) => e.id !== lenderEntityId);
  const [borrowerEntityId, setBorrowerEntityId] = useState('');

  const save = useMutation({
    mutationFn: () => api('/advances', { method: 'POST', body: { ...f, borrowerEntityId: borrowerEntityId || borrowers[0]?.id } }),
    onSuccess: () => { setF({ lenderAccountId: '', amount: '', beneficiary: '', purpose: '' }); router.refresh(); },
  });

  return (
    <Card>
      <CardTitle>Enregistrer une avance</CardTitle>
      <p className="mb-4 text-sm text-muted">
        À utiliser quand une entité a payé une dépense de l’autre. Ce n’est ni une recette ni une dépense pour l’entité qui avance :
        c’est une créance pour elle et une dette pour l’autre.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid max-w-3xl gap-x-4 sm:grid-cols-2">
        <Field label="Entité qui avance">
          <select className={inputClass} value={lenderEntityId} onChange={(e) => { setLenderEntityId(e.target.value); setF((s) => ({ ...s, lenderAccountId: '' })); }}>
            {lenderEntities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <Field label="Entité bénéficiaire">
          <select className={inputClass} value={borrowerEntityId || borrowers[0]?.id} onChange={(e) => setBorrowerEntityId(e.target.value)}>
            {borrowers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <Field label="Compte débité">
          <select required className={inputClass} value={f.lenderAccountId} onChange={(e) => setF({ ...f, lenderAccountId: e.target.value })}>
            <option value="">Choisir…</option>{mine.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
        </Field>
        <Field label="Montant"><MoneyInput required currency={lenderAccount?.currency ?? 'USD'} value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        <Field label="Bénéficiaire de la dépense"><input required className={inputClass} value={f.beneficiary} onChange={(e) => setF({ ...f, beneficiary: e.target.value })} /></Field>
        <Field label="Motif"><input required className={inputClass} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></Field>
        <div className="sm:col-span-2">
          <ErrorText>{save.error?.message}</ErrorText>
          <Button type="submit" disabled={save.isPending}>Enregistrer l’avance</Button>
        </div>
      </form>
    </Card>
  );
}
