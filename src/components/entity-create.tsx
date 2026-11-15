'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui/card';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';

const empty = { name: '', code: '', prefix: '' };

/** Création d'une entité supplémentaire dans l'organisation (administrateur). */
export function EntityCreate() {
  const router = useRouter();
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const create = useMutation({
    mutationFn: () => api('/entities', { method: 'POST', body: f }),
    onSuccess: () => { setF(empty); router.refresh(); },
  });

  return (
    <Card className="mb-6">
      <CardTitle>Nouvelle entité</CardTitle>
      <p className="mb-4 text-sm text-muted">
        Une entité est une structure distincte de votre organisation (ex. une école, une filiale), avec ses propres comptes, budgets et références.
        Vous en devenez administrateur ; ajoutez ensuite des rôles à vos collaborateurs dans « Utilisateurs ».
      </p>
      <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="grid max-w-xl gap-x-4 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <Field label="Nom de l’entité"><input value={f.name} onChange={(e) => set('name', e.target.value)} required className={inputClass} /></Field>
        </div>
        <Field label="Code" hint="Ex. ECOLE (sélecteur)"><input value={f.code} onChange={(e) => set('code', e.target.value.toUpperCase())} required maxLength={10} className={inputClass} /></Field>
        <Field label="Préfixe" hint="Ex. ECO (références)"><input value={f.prefix} onChange={(e) => set('prefix', e.target.value.toUpperCase())} required maxLength={5} className={inputClass} /></Field>
        <div className="sm:col-span-3">
          <ErrorText>{create.error?.message}</ErrorText>
          <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Création…' : 'Créer l’entité'}</Button>
        </div>
      </form>
    </Card>
  );
}
