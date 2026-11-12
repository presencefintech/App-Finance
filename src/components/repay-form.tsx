'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui/card';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';
import { MoneyInput } from '@/components/money';
import { formatMoney } from '@/lib/money';

type Currency = 'USD' | 'CDF';
interface Account { id: string; name: string; entityId: string; currency: Currency; balance: string; isActive: boolean }

export function RepayForm({
  advanceId, currency, remaining, borrowerEntityId, lenderEntityId,
}: { advanceId: string; currency: Currency; remaining: string; borrowerEntityId: string; lenderEntityId: string }) {
  const router = useRouter();
  const accounts = useQuery({ queryKey: ['accounts', 'all'], queryFn: () => api<{ data: Account[] }>('/accounts') });
  const [f, setF] = useState({ from: '', to: '', amount: '', fromAmount: '', rate: '', source: 'BCC', date: new Date().toISOString().slice(0, 10) });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const froms = accounts.data?.data.filter((a) => a.entityId === borrowerEntityId && a.isActive) ?? [];
  const tos = accounts.data?.data.filter((a) => a.entityId === lenderEntityId && a.isActive) ?? [];
  const from = froms.find((a) => a.id === f.from);
  const to = tos.find((a) => a.id === f.to);
  const needsFx = Boolean(from && to && (from.currency !== currency || to.currency !== currency));
  const payerInOther = Boolean(from && from.currency !== currency);

  const save = useMutation({
    mutationFn: () =>
      api(`/advances/${advanceId}/repayments`, {
        method: 'POST',
        body: {
          fromAccountId: f.from, toAccountId: f.to, amount: f.amount,
          ...(needsFx ? { fromAmount: payerInOther ? f.fromAmount : undefined, fx: { rate: f.rate, rateDate: f.date, rateSource: f.source } } : {}),
        },
      }),
    onSuccess: () => { setF((s) => ({ ...s, amount: '', fromAmount: '' })); router.refresh(); },
  });

  return (
    <Card>
      <CardTitle>Enregistrer un remboursement</CardTitle>
      <p className="mb-4 text-sm text-muted">Restant dû : <strong>{formatMoney(remaining, currency)}</strong>. Un remboursement n’est pas une recette pour l’entité qui reçoit.</p>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid max-w-2xl gap-x-4 sm:grid-cols-2">
        <Field label="Compte payeur (emprunteur)">
          <select required className={inputClass} value={f.from} onChange={(e) => set('from', e.target.value)}>
            <option value="">Choisir…</option>{froms.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency}) — {formatMoney(a.balance, a.currency)}</option>)}
          </select>
        </Field>
        <Field label="Compte bénéficiaire (prêteur)">
          <select required className={inputClass} value={f.to} onChange={(e) => set('to', e.target.value)}>
            <option value="">Choisir…</option>{tos.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
        </Field>
        <Field label={`Montant remboursé (en ${currency})`}><MoneyInput required currency={currency} value={f.amount} onChange={(v) => set('amount', v)} /></Field>
        {needsFx && (
          <div className="rounded-lg bg-warning/15 p-3 sm:col-span-2">
            <p className="mb-2 text-sm font-medium">Conversion {from?.currency} → {to?.currency}</p>
            <div className="grid gap-x-3 sm:grid-cols-3">
              {payerInOther && (
                <Field label={`Montant débité (${from?.currency})`}><MoneyInput required currency={from!.currency} value={f.fromAmount} onChange={(v) => set('fromAmount', v)} /></Field>
              )}
              <Field label={`1 ${from?.currency} =`}><input required inputMode="decimal" className={inputClass} value={f.rate} onChange={(e) => set('rate', e.target.value.replace(',', '.'))} /></Field>
              <Field label="Source du taux"><input required className={inputClass} value={f.source} onChange={(e) => set('source', e.target.value)} /></Field>
            </div>
          </div>
        )}
        <div className="sm:col-span-2">
          <ErrorText>{save.error?.message}</ErrorText>
          <Button type="submit" disabled={save.isPending}>Enregistrer le remboursement</Button>
        </div>
      </form>
    </Card>
  );
}
