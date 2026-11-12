'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui/card';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';
import { StatusBadge } from '@/components/ui/status-badge';

interface Category { id: string; name: string; kind: 'INCOME' | 'EXPENSE'; isActive: boolean }
interface Department { id: string; name: string }

export function ReferentialsAdmin({ entities }: { entities: { id: string; name: string }[] }) {
  const qc = useQueryClient();
  const [entityId, setEntityId] = useState(entities[0]?.id ?? '');
  const cats = useQuery({ queryKey: ['categories', entityId], queryFn: () => api<{ data: Category[] }>(`/categories?entityId=${entityId}`) });
  const deps = useQuery({ queryKey: ['departments', entityId], queryFn: () => api<{ data: Department[] }>(`/departments?entityId=${entityId}`) });
  const [catForm, setCatForm] = useState({ name: '', kind: 'EXPENSE' as 'INCOME' | 'EXPENSE' });
  const [depName, setDepName] = useState('');

  const addCat = useMutation({
    mutationFn: () => api('/categories', { method: 'POST', body: { entityId, ...catForm } }),
    onSuccess: () => { setCatForm((f) => ({ ...f, name: '' })); qc.invalidateQueries({ queryKey: ['categories'] }); },
  });
  const toggleCat = useMutation({
    mutationFn: (c: Category) => api(`/categories/${c.id}`, { method: 'PATCH', body: { isActive: !c.isActive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
  const addDep = useMutation({
    mutationFn: () => api('/departments', { method: 'POST', body: { entityId, name: depName } }),
    onSuccess: () => { setDepName(''); qc.invalidateQueries({ queryKey: ['departments'] }); },
  });

  return (
    <div className="grid gap-6">
      <Card>
        <Field label="Entité">
          <select className={`${inputClass} max-w-xs`} value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle>Catégories</CardTitle>
          <ul className="mb-4 divide-y divide-border text-sm">
            {cats.data?.data.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2">
                <span>{c.name} <StatusBadge tone={c.kind === 'INCOME' ? 'success' : 'neutral'}>{c.kind === 'INCOME' ? 'Recette' : 'Dépense'}</StatusBadge></span>
                <Button variant="ghost" onClick={() => toggleCat.mutate(c)}>{c.isActive ? 'Désactiver' : 'Réactiver'}</Button>
              </li>
            ))}
          </ul>
          <form onSubmit={(e) => { e.preventDefault(); addCat.mutate(); }} className="flex flex-wrap items-end gap-2">
            <Field label="Nouvelle catégorie"><input required className={inputClass} value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} /></Field>
            <Field label="Type">
              <select className={inputClass} value={catForm.kind} onChange={(e) => setCatForm({ ...catForm, kind: e.target.value as 'INCOME' | 'EXPENSE' })}>
                <option value="EXPENSE">Dépense</option><option value="INCOME">Recette</option>
              </select>
            </Field>
            <Button type="submit" className="mb-4" disabled={addCat.isPending}>Ajouter</Button>
          </form>
          <ErrorText>{addCat.error?.message ?? toggleCat.error?.message}</ErrorText>
        </Card>
        <Card>
          <CardTitle>Départements / sections</CardTitle>
          <ul className="mb-4 divide-y divide-border text-sm">
            {deps.data?.data.length === 0 && <li className="py-2 text-muted">Aucun département.</li>}
            {deps.data?.data.map((d) => <li key={d.id} className="py-2">{d.name}</li>)}
          </ul>
          <form onSubmit={(e) => { e.preventDefault(); addDep.mutate(); }} className="flex items-end gap-2">
            <Field label="Nouveau département"><input required className={inputClass} value={depName} onChange={(e) => setDepName(e.target.value)} /></Field>
            <Button type="submit" className="mb-4" disabled={addDep.isPending}>Ajouter</Button>
          </form>
          <ErrorText>{addDep.error?.message}</ErrorText>
        </Card>
      </div>
    </div>
  );
}
