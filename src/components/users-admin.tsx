'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ROLE_LABELS, ROLE_OPTIONS } from '@/lib/labels';
import { Card, CardTitle } from '@/components/ui/card';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';
import { StatusBadge } from '@/components/ui/status-badge';

type Role = keyof typeof ROLE_LABELS;
interface Entity { id: string; code: string; name: string }
interface UserRow {
  id: string; email: string; fullName: string; isActive: boolean; totpEnabledAt: string | null;
  roles: { entityId: string; role: Role }[];
}

export function UsersAdmin({ currentUserId }: { currentUserId: string }) {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ data: UserRow[] }>('/users') });
  const entities = useQuery({ queryKey: ['entities'], queryFn: () => api<{ data: Entity[] }>('/entities') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });

  const toggle = useMutation({
    mutationFn: (u: UserRow) => api(`/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.isActive } }),
    onSuccess: refresh,
  });
  const setRoles = useMutation({
    mutationFn: (v: { id: string; roles: { entityId: string; role: Role }[] }) =>
      api(`/users/${v.id}/roles`, { method: 'PUT', body: { roles: v.roles } }),
    onSuccess: refresh,
  });

  const [form, setForm] = useState({ email: '', fullName: '', password: '' });
  const [newRoles, setNewRoles] = useState<{ entityId: string; role: Role }[]>([]);
  const create = useMutation({
    mutationFn: () => api('/users', { method: 'POST', body: { ...form, roles: newRoles } }),
    onSuccess: () => {
      setForm({ email: '', fullName: '', password: '' });
      setNewRoles([]);
      refresh();
    },
  });

  const hasRole = (list: { entityId: string; role: Role }[], entityId: string, role: Role) =>
    list.some((r) => r.entityId === entityId && r.role === role);
  const flip = (list: { entityId: string; role: Role }[], entityId: string, role: Role) =>
    hasRole(list, entityId, role) ? list.filter((r) => !(r.entityId === entityId && r.role === role)) : [...list, { entityId, role }];

  return (
    <div className="grid gap-6">
      <Card>
        <CardTitle>Utilisateurs</CardTitle>
        <ErrorText>{toggle.error?.message ?? setRoles.error?.message}</ErrorText>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr><th className="pb-2">Utilisateur</th><th>Rôles par entité</th><th>2FA</th><th>Statut</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.data?.data.map((u) => (
                <tr key={u.id} className="align-top">
                  <td className="py-3 pr-3">
                    <div className="font-medium">{u.fullName}</div>
                    <div className="text-xs text-muted">{u.email}</div>
                  </td>
                  <td className="py-3 pr-3">
                    {entities.data?.data.map((e) => (
                      <div key={e.id} className="mb-1 flex flex-wrap items-center gap-1">
                        <span className="w-12 text-xs font-medium text-muted">{e.code}</span>
                        {ROLE_OPTIONS.map((role) => (
                          <button
                            key={role}
                            title={ROLE_LABELS[role]}
                            onClick={() => setRoles.mutate({ id: u.id, roles: flip(u.roles, e.id, role) })}
                            className={`rounded-full px-2 py-0.5 text-xs ${hasRole(u.roles, e.id, role) ? 'bg-primary text-white' : 'border border-border text-muted'}`}
                          >
                            {role}
                          </button>
                        ))}
                      </div>
                    ))}
                  </td>
                  <td className="py-3 pr-3">
                    {u.totpEnabledAt ? <StatusBadge tone="success">Oui</StatusBadge> : <StatusBadge>Non</StatusBadge>}
                  </td>
                  <td className="py-3 pr-3">
                    {u.isActive ? <StatusBadge tone="success">Actif</StatusBadge> : <StatusBadge tone="danger">Désactivé</StatusBadge>}
                  </td>
                  <td className="py-3 text-right">
                    {u.id !== currentUserId && (
                      <Button variant="ghost" onClick={() => toggle.mutate(u)} disabled={toggle.isPending}>
                        {u.isActive ? 'Désactiver' : 'Réactiver'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardTitle>Nouvel utilisateur</CardTitle>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="grid max-w-xl gap-x-4 sm:grid-cols-2">
          <Field label="Nom complet">
            <input className={inputClass} required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </Field>
          <Field label="E-mail">
            <input className={inputClass} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Mot de passe initial" hint="12 caractères minimum, à communiquer de façon sécurisée">
            <input className={inputClass} type="password" minLength={12} required autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <div className="mb-4 text-sm">
            <span className="mb-1 block font-medium">Rôles</span>
            {entities.data?.data.map((e) => (
              <div key={e.id} className="mb-1 flex flex-wrap items-center gap-1">
                <span className="w-12 text-xs font-medium text-muted">{e.code}</span>
                {ROLE_OPTIONS.map((role) => (
                  <button
                    type="button" key={role} onClick={() => setNewRoles(flip(newRoles, e.id, role))}
                    className={`rounded-full px-2 py-0.5 text-xs ${hasRole(newRoles, e.id, role) ? 'bg-primary text-white' : 'border border-border text-muted'}`}
                  >
                    {role}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="sm:col-span-2">
            <ErrorText>{create.error?.message}</ErrorText>
            <Button type="submit" disabled={create.isPending}>Créer l&apos;utilisateur</Button>
            <span className="ml-3 text-xs text-muted">Les rôles ADMIN, CONTROLLER, DIRECTOR et CASHIER devront activer la 2FA à leur première connexion.</span>
          </div>
        </form>
      </Card>
    </div>
  );
}
