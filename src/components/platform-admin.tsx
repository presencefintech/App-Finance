'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui/card';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDate } from '@/lib/format';

interface Org { id: string; name: string; slug: string; isActive: boolean; createdAt: string; entities: number; users: number }

const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Gestion des organisations clientes (administrateur de la plateforme uniquement). */
export function PlatformAdmin({ organizations }: { organizations: Org[] }) {
  const router = useRouter();
  const [f, setF] = useState({ name: '', slug: '', entityName: '', entityCode: '', entityPrefix: '', adminName: '', adminEmail: '', adminPassword: '' });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const create = useMutation({
    mutationFn: () => api('/platform/organizations', { method: 'POST', body: f }),
    onSuccess: () => { setF({ name: '', slug: '', entityName: '', entityCode: '', entityPrefix: '', adminName: '', adminEmail: '', adminPassword: '' }); router.refresh(); },
  });
  const toggle = useMutation({
    mutationFn: (o: Org) => api(`/platform/organizations/${o.id}`, { method: 'PATCH', body: { isActive: !o.isActive } }),
    onSuccess: () => router.refresh(),
  });

  return (
    <div className="grid gap-6">
      <Card>
        <CardTitle>Organisations clientes</CardTitle>
        <p className="mb-4 text-sm text-muted">
          Chaque organisation est totalement isolée des autres (au niveau de la base de données). Cet écran ne donne accès à aucune de leurs données financières.
        </p>
        <ErrorText>{toggle.error?.message}</ErrorText>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted"><tr><th className="pb-2">Organisation</th><th>Identifiant</th><th>Entités</th><th>Utilisateurs</th><th>Créée le</th><th>Statut</th><th /></tr></thead>
          <tbody className="divide-y divide-border">
            {organizations.length === 0 && <tr><td colSpan={7} className="py-6 text-muted">Aucune organisation.</td></tr>}
            {organizations.map((o) => (
              <tr key={o.id}>
                <td className="py-2 pr-3 font-medium">{o.name}</td>
                <td className="pr-3 font-mono text-xs">{o.slug}</td>
                <td className="pr-3">{o.entities}</td>
                <td className="pr-3">{o.users}</td>
                <td className="pr-3">{formatDate(o.createdAt)}</td>
                <td className="pr-3">{o.isActive ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge tone="danger">Suspendue</StatusBadge>}</td>
                <td className="text-right"><Button variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate(o)}>{o.isActive ? 'Suspendre' : 'Réactiver'}</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <CardTitle>Nouvelle organisation</CardTitle>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="grid max-w-3xl gap-x-4 sm:grid-cols-2">
          <Field label="Nom de l’organisation"><input required className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: slugify(e.target.value) })} /></Field>
          <Field label="Identifiant" hint="Minuscules, chiffres et tirets"><input required className={inputClass} value={f.slug} onChange={(e) => set('slug', e.target.value)} /></Field>
          <Field label="Première entité (nom)"><input required className={inputClass} value={f.entityName} onChange={(e) => set('entityName', e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-x-3">
            <Field label="Code" hint="ex. SEC"><input required className={inputClass} value={f.entityCode} onChange={(e) => set('entityCode', e.target.value.toUpperCase())} /></Field>
            <Field label="Préfixe références" hint="ex. SEC"><input required maxLength={5} className={inputClass} value={f.entityPrefix} onChange={(e) => set('entityPrefix', e.target.value.toUpperCase())} /></Field>
          </div>
          <Field label="Administrateur (nom)"><input required className={inputClass} value={f.adminName} onChange={(e) => set('adminName', e.target.value)} /></Field>
          <Field label="Administrateur (e-mail)"><input required type="email" className={inputClass} value={f.adminEmail} onChange={(e) => set('adminEmail', e.target.value)} /></Field>
          <Field label="Mot de passe initial" hint="12 caractères minimum, à communiquer de façon sécurisée"><input required type="password" minLength={12} autoComplete="new-password" className={inputClass} value={f.adminPassword} onChange={(e) => set('adminPassword', e.target.value)} /></Field>
          <div className="sm:col-span-2">
            <ErrorText>{create.error?.message}</ErrorText>
            <Button type="submit" disabled={create.isPending}>Créer l’organisation</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
