'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui/card';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';
import { StatusBadge } from '@/components/ui/status-badge';
import { useStepUp } from '@/components/providers';
import { formatMoney } from '@/lib/money';

interface Limit { entityId: string; role: 'CONTROLLER' | 'DIRECTOR'; currency: 'USD' | 'CDF'; maxAmount: string | null; isDefault: boolean }
interface Setting { key: string; value: string; default: string }

const SETTING_LABELS: Record<string, string> = {
  allowSameApproverCashier: 'Autoriser l’approbateur à décaisser la même demande (équipe trop petite) — tracé dans l’audit',
  advanceAlertDays: 'Alerte sur les avances ouvertes depuis plus de … jours',
};

export function LimitsAdmin({ entities }: { entities: { id: string; name: string }[] }) {
  const qc = useQueryClient();
  const withStepUp = useStepUp();
  const [entityId, setEntityId] = useState(entities[0]?.id ?? '');
  const [edit, setEdit] = useState<Record<string, string>>({});

  const limits = useQuery({ queryKey: ['limits', entityId], queryFn: () => api<{ data: Limit[] }>(`/settings/approval-limits?entityId=${entityId}`) });
  const settings = useQuery({ queryKey: ['app-settings'], queryFn: () => api<{ data: Setting[] }>('/settings/app') });

  const saveLimit = useMutation({
    mutationFn: (l: Limit) => withStepUp(() => api('/settings/approval-limits', { method: 'PUT', body: { entityId, role: l.role, currency: l.currency, maxAmount: edit[`${l.role}-${l.currency}`] } })),
    onSuccess: () => { setEdit({}); qc.invalidateQueries({ queryKey: ['limits'] }); },
  });
  const saveSetting = useMutation({
    mutationFn: (v: { key: string; value: string }) => withStepUp(() => api('/settings/app', { method: 'PUT', body: v })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app-settings'] }),
  });

  return (
    <div className="grid gap-6">
      <Card>
        <CardTitle>Plafonds d’approbation</CardTitle>
        <Field label="Entité">
          <select className={`${inputClass} max-w-xs`} value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <table className="w-full max-w-2xl text-sm">
          <thead className="text-left text-xs text-muted"><tr><th className="pb-2">Rôle</th><th>Devise</th><th>Plafond</th><th /></tr></thead>
          <tbody className="divide-y divide-border">
            {limits.data?.data.map((l) => {
              const k = `${l.role}-${l.currency}`;
              return (
                <tr key={k}>
                  <td className="py-2">{l.role === 'CONTROLLER' ? 'Contrôleuse' : 'Direction'}</td>
                  <td>{l.currency}</td>
                  <td>
                    {l.maxAmount ? formatMoney(l.maxAmount, l.currency) : 'Illimité'} {l.isDefault && <StatusBadge>par défaut</StatusBadge>}
                  </td>
                  <td className="py-2 text-right">
                    <input
                      className={`${inputClass} mr-2 inline-block w-32`} placeholder="Nouveau plafond" inputMode="decimal"
                      value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value.replace(',', '.') })}
                    />
                    <Button variant="ghost" disabled={!edit[k] || saveLimit.isPending} onClick={() => saveLimit.mutate(l)}>Enregistrer</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">Modifier un plafond demande une confirmation par code 2FA et est tracé dans le journal d’audit.</p>
        <ErrorText>{saveLimit.error?.message}</ErrorText>
      </Card>

      <Card>
        <CardTitle>Règles</CardTitle>
        <ul className="divide-y divide-border text-sm">
          {settings.data?.data.map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-4 py-3">
              <span className="max-w-xl">{SETTING_LABELS[s.key] ?? s.key}</span>
              {s.key === 'allowSameApproverCashier' ? (
                <Button variant={s.value === 'true' ? 'danger' : 'ghost'} onClick={() => saveSetting.mutate({ key: s.key, value: s.value === 'true' ? 'false' : 'true' })}>
                  {s.value === 'true' ? 'Activé — désactiver' : 'Désactivé — activer'}
                </Button>
              ) : (
                <input
                  className={`${inputClass} w-24`} defaultValue={s.value} inputMode="numeric"
                  onBlur={(e) => e.target.value !== s.value && saveSetting.mutate({ key: s.key, value: e.target.value })}
                />
              )}
            </li>
          ))}
        </ul>
        <ErrorText>{saveSetting.error?.message}</ErrorText>
      </Card>
    </div>
  );
}
