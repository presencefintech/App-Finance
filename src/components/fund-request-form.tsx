'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui/card';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';
import { MoneyInput } from '@/components/money';

export function FundRequestForm({ entities }: { entities: { id: string; name: string }[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    entityId: entities[0]?.id ?? '', amount: '', currency: 'USD' as 'USD' | 'CDF', purpose: '',
  });
  const save = useMutation({
    mutationFn: (submit: boolean) => api<{ id: string }>('/fund-requests', { method: 'POST', body: { ...form, submit } }),
    onSuccess: (r) => router.push(`/demandes/${r.id}`),
  });

  return (
    <Card className="mx-auto max-w-2xl">
      <CardTitle>Nouvelle demande de fonds</CardTitle>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(true); }}>
        {entities.length > 1 && (
          <Field label="Entité">
            <select className={inputClass} value={form.entityId} onChange={(e) => setForm({ ...form, entityId: e.target.value })}>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>
        )}
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Montant">
            <MoneyInput required currency={form.currency} value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
          </Field>
          <Field label="Devise">
            <select className={inputClass} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as 'USD' | 'CDF' })}>
              <option value="USD">USD</option>
              <option value="CDF">CDF</option>
            </select>
          </Field>
        </div>
        <Field label="Motif détaillé" hint="10 caractères minimum">
          <textarea required rows={5} className={inputClass} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
        </Field>
        <ErrorText>{save.error?.message}</ErrorText>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending}>Soumettre</Button>
          <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => save.mutate(false)}>Enregistrer en brouillon</Button>
        </div>
      </form>
    </Card>
  );
}
