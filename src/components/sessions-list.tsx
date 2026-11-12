'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/form';
import { formatDateTime } from '@/lib/format';
import { StatusBadge } from '@/components/ui/status-badge';

interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  lastSeenAt: string;
  current: boolean;
}

export function SessionsList() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ data: SessionRow[] }>('/auth/sessions') });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });

  return (
    <ul className="divide-y divide-border text-sm">
      {data?.data.map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <div className="truncate">{s.userAgent ?? 'Appareil inconnu'}</div>
            <div className="text-xs text-muted">
              {s.ip ?? 'IP inconnue'} · dernière activité {formatDateTime(s.lastSeenAt)}
            </div>
          </div>
          {s.current ? (
            <StatusBadge tone="success">Session actuelle</StatusBadge>
          ) : (
            <Button variant="ghost" onClick={() => revoke.mutate(s.id)} disabled={revoke.isPending}>
              Révoquer
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
