'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui/card';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';
import { MoneyInput } from '@/components/money';

type Currency = 'USD' | 'CDF';
export interface AccountOption { id: string; name: string; type: 'CASH' | 'BANK'; currency: Currency }
export interface CategoryOption { id: string; name: string; kind: 'INCOME' | 'EXPENSE' }
interface Props {
  account: AccountOption;
  others: AccountOption[];
  categories: CategoryOption[];
  canRecord: boolean;
  canClose: boolean;
}

type Mode = 'movement' | 'cashTransfer' | 'deposit' | 'close' | 'withdrawal' | 'bankTransfer' | 'fee' | 'depositFromCash';
const MODES: Record<'CASH' | 'BANK', { id: Mode; label: string }[]> = {
  CASH: [
    { id: 'movement', label: 'Entrée / sortie' }, { id: 'cashTransfer', label: 'Vers une autre caisse' },
    { id: 'deposit', label: 'Versement en banque' }, { id: 'close', label: 'Clôture du jour' },
  ],
  BANK: [
    { id: 'withdrawal', label: 'Retrait vers une caisse' }, { id: 'depositFromCash', label: 'Versement depuis une caisse' },
    { id: 'bankTransfer', label: 'Virement' }, { id: 'fee', label: 'Frais bancaires' },
  ],
};

const today = () => new Date().toISOString().slice(0, 10);

export function AccountActions({ account, others, categories, canRecord, canClose }: Props) {
  const router = useRouter();
  const modes = MODES[account.type].filter((m) => (m.id === 'close' ? canClose : canRecord));
  const [mode, setMode] = useState<Mode | null>(null);
  const [f, setF] = useState({
    amount: '', target: '', category: '', direction: 'IN', party: '', description: '', counted: '', justification: '',
    rate: '', rateSource: 'BCC', rateDate: today(),
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const target = others.find((o) => o.id === f.target);
  const needsFx = Boolean(target && target.currency !== account.currency && mode && mode !== 'withdrawal');
  const fxPair = target ? { base: account.currency, quote: target.currency } : null;

  // Dernier taux connu proposé, toujours modifiable (SPEC §6.7).
  useQuery({
    queryKey: ['latest-rate', fxPair?.base, fxPair?.quote],
    enabled: needsFx && Boolean(fxPair),
    queryFn: async () => {
      const r = await api<{ rate: string; source: string }>(`/exchange-rates/latest?base=${fxPair!.base}&quote=${fxPair!.quote}`).catch(() => null);
      if (r) setF((s) => ({ ...s, rate: s.rate || r.rate, rateSource: r.source }));
      return r;
    },
  });

  const fx = needsFx ? { rate: f.rate, rateDate: f.rateDate, rateSource: f.rateSource } : undefined;

  const run = useMutation({
    mutationFn: () => {
      const amount = f.amount;
      switch (mode) {
        case 'movement':
          return api(`/cash/${account.id}/movements`, { method: 'POST', body: { direction: f.direction, amount, categoryId: f.category, counterparty: f.party, description: f.description } });
        case 'cashTransfer':
          return api('/cash/transfers', { method: 'POST', body: { fromAccountId: account.id, toAccountId: f.target, amount, description: f.description || undefined, fx } });
        case 'deposit':
          return api('/bank/deposits', { method: 'POST', body: { cashAccountId: account.id, bankAccountId: f.target, amount, description: f.description || undefined, fx } });
        case 'depositFromCash':
          return api('/bank/deposits', { method: 'POST', body: { cashAccountId: f.target, bankAccountId: account.id, amount, description: f.description || undefined, fx } });
        case 'withdrawal':
          return api('/bank/withdrawals', { method: 'POST', body: { bankAccountId: account.id, cashAccountId: f.target, amount, description: f.description || undefined } });
        case 'bankTransfer':
          return api('/bank/transfers', { method: 'POST', body: { fromAccountId: account.id, toAccountId: f.target, amount, description: f.description || undefined, fx } });
        case 'fee':
          return api('/bank/fees', { method: 'POST', body: { bankAccountId: account.id, amount, description: f.description } });
        case 'close':
          return api(`/cash/${account.id}/closings`, { method: 'POST', body: { countedBalance: f.counted, justification: f.justification || undefined } });
        default:
          throw new Error('Choisissez une action');
      }
    },
    onSuccess: () => { setMode(null); setF((s) => ({ ...s, amount: '', description: '', party: '', counted: '', justification: '' })); router.refresh(); },
  });

  if (modes.length === 0) return null;

  // Comptes cibles selon l'action.
  const targetType = mode === 'cashTransfer' || mode === 'withdrawal' || mode === 'depositFromCash' ? 'CASH' : 'BANK';
  const targets = others.filter((o) => o.type === targetType && (mode !== 'withdrawal' || o.currency === account.currency));
  const cats = categories.filter((c) => c.kind === (f.direction === 'IN' ? 'INCOME' : 'EXPENSE'));
  const needsTarget = mode && !['movement', 'fee', 'close'].includes(mode);

  return (
    <Card>
      <CardTitle>Opérations</CardTitle>
      <div className="mb-4 flex flex-wrap gap-2">
        {modes.map((m) => (
          <Button key={m.id} variant={mode === m.id ? 'primary' : 'ghost'} onClick={() => { run.reset(); setMode(m.id); }}>{m.label}</Button>
        ))}
      </div>

      {mode && (
        <form onSubmit={(e) => { e.preventDefault(); run.mutate(); }} className="grid max-w-2xl gap-x-4 sm:grid-cols-2">
          {mode === 'movement' && (
            <>
              <Field label="Sens">
                <select className={inputClass} value={f.direction} onChange={(e) => set('direction', e.target.value)}>
                  <option value="IN">Entrée (recette)</option><option value="OUT">Sortie (dépense)</option>
                </select>
              </Field>
              <Field label="Catégorie">
                <select required className={inputClass} value={f.category} onChange={(e) => set('category', e.target.value)}>
                  <option value="">Choisir…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label={f.direction === 'IN' ? 'Origine' : 'Bénéficiaire'}>
                <input required className={inputClass} value={f.party} onChange={(e) => set('party', e.target.value)} />
              </Field>
            </>
          )}
          {needsTarget && (
            <Field label={mode === 'withdrawal' || mode === 'depositFromCash' ? 'Caisse' : mode === 'cashTransfer' ? 'Caisse de destination' : 'Compte bancaire'}>
              <select required className={inputClass} value={f.target} onChange={(e) => set('target', e.target.value)}>
                <option value="">Choisir…</option>{targets.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.currency})</option>)}
              </select>
            </Field>
          )}
          {mode === 'close' ? (
            <>
              <Field label="Montant compté (physique)"><MoneyInput required currency={account.currency} value={f.counted} onChange={(v) => set('counted', v)} /></Field>
              <Field label="Justification" hint="Obligatoire en cas d’écart">
                <input className={inputClass} value={f.justification} onChange={(e) => set('justification', e.target.value)} />
              </Field>
            </>
          ) : (
            <Field label="Montant"><MoneyInput required currency={account.currency} value={f.amount} onChange={(v) => set('amount', v)} /></Field>
          )}
          {needsFx && (
            <div className="rounded-lg bg-warning/15 p-3 sm:col-span-2">
              <p className="mb-2 text-sm font-medium">Conversion {account.currency} → {target?.currency}</p>
              <div className="grid gap-x-3 sm:grid-cols-3">
                <Field label={`1 ${account.currency} =`}><input required inputMode="decimal" className={inputClass} value={f.rate} onChange={(e) => set('rate', e.target.value.replace(',', '.'))} /></Field>
                <Field label="Source du taux"><input required className={inputClass} value={f.rateSource} onChange={(e) => set('rateSource', e.target.value)} /></Field>
                <Field label="Date du taux"><input required type="date" className={inputClass} value={f.rateDate} onChange={(e) => set('rateDate', e.target.value)} /></Field>
              </div>
            </div>
          )}
          {mode !== 'close' && mode !== 'movement' && (
            <div className="sm:col-span-2">
              <Field label={mode === 'fee' ? 'Libellé' : 'Libellé (optionnel)'}>
                <input required={mode === 'fee'} className={inputClass} value={f.description} onChange={(e) => set('description', e.target.value)} />
              </Field>
            </div>
          )}
          {mode === 'movement' && (
            <div className="sm:col-span-2">
              <Field label="Motif"><input required className={inputClass} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
            </div>
          )}
          <div className="sm:col-span-2">
            <ErrorText>{run.error?.message}</ErrorText>
            <Button type="submit" disabled={run.isPending}>Valider</Button>
            {mode === 'withdrawal' && <span className="ml-3 text-xs text-muted">Le retrait restera « en transit » jusqu’à confirmation par le caissier.</span>}
          </div>
        </form>
      )}
    </Card>
  );
}
