'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui/card';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';
import { MoneyInput } from '@/components/money';

interface Ref { id: string; entityId: string; name: string }
interface Line { departmentId: string; categoryId: string; amount: string }

export function BudgetForm({ entities, departments, categories }: { entities: { id: string; name: string }[]; departments: Ref[]; categories: Ref[] }) {
  const router = useRouter();
  const [entityId, setEntityId] = useState(entities[0]?.id ?? '');
  const [f, setF] = useState({ name: '', currency: 'USD' as 'USD' | 'CDF', periodStart: new Date().toISOString().slice(0, 10), periodEnd: '' });
  const [lines, setLines] = useState<Line[]>([{ departmentId: '', categoryId: '', amount: '' }]);
  const deps = departments.filter((d) => d.entityId === entityId);
  const cats = categories.filter((c) => c.entityId === entityId);
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = useMutation({
    mutationFn: () =>
      api('/budgets', {
        method: 'POST',
        body: {
          entityId, ...f,
          lines: lines.map((l) => ({ departmentId: l.departmentId || undefined, categoryId: l.categoryId || undefined, amount: l.amount })),
        },
      }),
    onSuccess: () => { setF((s) => ({ ...s, name: '' })); setLines([{ departmentId: '', categoryId: '', amount: '' }]); router.refresh(); },
  });

  return (
    <Card>
      <CardTitle>Nouveau budget</CardTitle>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="max-w-3xl">
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Entité">
            <select className={inputClass} value={entityId} onChange={(e) => setEntityId(e.target.value)}>{entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
          </Field>
          <Field label="Nom"><input required className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Début"><input required type="date" className={inputClass} value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} /></Field>
          <Field label="Fin"><input required type="date" className={inputClass} value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} /></Field>
          <Field label="Devise">
            <select className={inputClass} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as 'USD' | 'CDF' })}><option>USD</option><option>CDF</option></select>
          </Field>
        </div>
        <h3 className="mb-2 mt-2 text-sm font-semibold">Lignes (département et/ou catégorie)</h3>
        {lines.map((l, i) => (
          <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1fr_1fr_10rem_auto]">
            <select className={inputClass} value={l.departmentId} onChange={(e) => setLine(i, { departmentId: e.target.value })}>
              <option value="">Tous départements</option>{deps.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select className={inputClass} value={l.categoryId} onChange={(e) => setLine(i, { categoryId: e.target.value })}>
              <option value="">Toutes catégories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <MoneyInput required currency={f.currency} value={l.amount} onChange={(v) => setLine(i, { amount: v })} />
            <Button type="button" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length === 1}>✕</Button>
          </div>
        ))}
        <Button type="button" variant="ghost" onClick={() => setLines((ls) => [...ls, { departmentId: '', categoryId: '', amount: '' }])}>+ Ajouter une ligne</Button>
        <div className="mt-4">
          <ErrorText>{save.error?.message}</ErrorText>
          <Button type="submit" disabled={save.isPending}>Créer le budget</Button>
        </div>
      </form>
    </Card>
  );
}
