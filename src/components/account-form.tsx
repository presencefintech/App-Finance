'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui/card';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';
import { MoneyInput } from '@/components/money';
import { useStepUp } from '@/components/providers';

interface Props {
  type: 'CASH' | 'BANK';
  entities: { id: string; name: string }[];
}

export function AccountForm({ type, entities }: Props) {
  const router = useRouter();
  const withStepUp = useStepUp();
  const [form, setForm] = useState({
    entityId: entities[0]?.id ?? '', name: '', currency: 'USD' as 'USD' | 'CDF',
    bankName: '', accountNumber: '', openingBalance: '',
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: () =>
      withStepUp(() =>
        api('/accounts', {
          method: 'POST',
          body: {
            entityId: form.entityId, type, name: form.name, currency: form.currency,
            ...(type === 'BANK' ? { bankName: form.bankName || undefined, accountNumber: form.accountNumber || undefined } : {}),
            openingBalance: form.openingBalance || undefined,
          },
        }),
      ),
    onSuccess: () => {
      setForm((f) => ({ ...f, name: '', bankName: '', accountNumber: '', openingBalance: '' }));
      router.refresh();
    },
  });

  return (
    <Card>
      <CardTitle>{type === 'CASH' ? 'Nouvelle caisse' : 'Nouveau compte bancaire'}</CardTitle>
      <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="grid max-w-2xl gap-x-4 sm:grid-cols-2">
        <Field label="Entité">
          <select className={inputClass} value={form.entityId} onChange={(e) => set('entityId', e.target.value)}>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <Field label="Nom">
          <input className={inputClass} required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={type === 'CASH' ? 'Caisse principale' : 'Rawbank USD'} />
        </Field>
        <Field label="Devise">
          <select className={inputClass} value={form.currency} onChange={(e) => set('currency', e.target.value as 'USD' | 'CDF')}>
            <option value="USD">USD</option>
            <option value="CDF">CDF</option>
          </select>
        </Field>
        <Field label="Solde initial" hint="Optionnel — enregistré comme écriture d'ouverture (contrôleuse financière)">
          <MoneyInput currency={form.currency} value={form.openingBalance} onChange={(v) => set('openingBalance', v)} />
        </Field>
        {type === 'BANK' && (
          <>
            <Field label="Banque">
              <input className={inputClass} value={form.bankName} onChange={(e) => set('bankName', e.target.value)} />
            </Field>
            <Field label="Numéro de compte" hint="Chiffré, affiché masqué">
              <input className={inputClass} value={form.accountNumber} onChange={(e) => set('accountNumber', e.target.value)} autoComplete="off" />
            </Field>
          </>
        )}
        <div className="sm:col-span-2">
          <ErrorText>{create.error?.message}</ErrorText>
          <Button type="submit" disabled={create.isPending}>Créer</Button>
        </div>
      </form>
    </Card>
  );
}
