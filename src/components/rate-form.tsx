'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui/card';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';

export function RateForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10), base: 'USD', quote: 'CDF', rate: '', source: 'BCC',
  });
  const save = useMutation({
    mutationFn: () => api('/exchange-rates', { method: 'POST', body: form }),
    onSuccess: () => { setForm((f) => ({ ...f, rate: '' })); router.refresh(); },
  });
  return (
    <Card>
      <CardTitle>Saisir un taux</CardTitle>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Date"><input type="date" required className={inputClass} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label="Source" hint="BCC, banque, marché, manuel…"><input required className={inputClass} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></Field>
        <Field label="Devise de base">
          <select className={inputClass} value={form.base} onChange={(e) => setForm({ ...form, base: e.target.value })}><option>USD</option><option>CDF</option></select>
        </Field>
        <Field label="Devise cotée">
          <select className={inputClass} value={form.quote} onChange={(e) => setForm({ ...form, quote: e.target.value })}><option>CDF</option><option>USD</option></select>
        </Field>
        <Field label={`1 ${form.base} = … ${form.quote}`} hint="6 décimales maximum">
          <input required inputMode="decimal" className={inputClass} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value.replace(',', '.') })} />
        </Field>
        <div className="sm:col-span-2">
          <ErrorText>{save.error?.message}</ErrorText>
          <Button type="submit" disabled={save.isPending}>Enregistrer</Button>
        </div>
      </form>
    </Card>
  );
}
