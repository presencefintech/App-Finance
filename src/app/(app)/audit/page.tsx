import { redirect } from 'next/navigation';
import { MANAGER_ROLES } from '@/lib/permissions';
import { Forbidden } from '@/components/forbidden';
import { canAccessPath } from '@/lib/navigation';
import { Card, CardTitle } from '@/components/ui/card';
import { SettingsNav } from '@/components/settings-nav';
import { BarChart } from '@/components/charts/bar-chart';
import { ChartCard } from '@/components/charts/chart-card';
import { activityByDay } from '@/server/modules/stats/service';
import { formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/server/auth';
import { AppError } from '@/server/errors';
import { listAuditLogs } from '@/server/modules/audit/service';

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; type?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath('/audit', user.roles)) return <Forbidden />;
  const sp = await searchParams;
  let logs;
  try {
    logs = await listAuditLogs(user, { action: sp.action, entityType: sp.type, limit: 200 });
  } catch (e) {
    if (e instanceof AppError && e.httpStatus === 403) return <Card>Accès au journal d’audit refusé.</Card>;
    throw e;
  }
  const activity = activityByDay(logs.map((l) => l.at), 14);
  return (
    <>
      {user.roles.some((r) => MANAGER_ROLES.includes(r.role)) && <SettingsNav current="/audit" />}
      <ChartCard className="mb-6" title="Activité des 14 derniers jours" subtitle="Nombre d’actions tracées par jour" legend={[{ name: 'Actions', color: 'var(--series-3)' }]}
        table={{ columns: ['Jour', 'Actions'], rows: activity.map((a) => [a.label, a.count]) }}>
        <BarChart label="Actions tracées par jour" categories={activity.map((a) => a.label)} height={160} series={[{ name: 'Actions', color: 'var(--series-3)', values: activity.map((a) => a.count) }]} />
      </ChartCard>
      <Card>
        <CardTitle>Journal d’audit</CardTitle>
        <form className="mb-4 flex flex-wrap gap-2 text-sm" method="get">
          <input name="action" defaultValue={sp.action} placeholder="Action (ex. fundRequest)" className="rounded-lg border border-border px-3 py-1.5" />
          <input name="type" defaultValue={sp.type} placeholder="Type (ex. Account)" className="rounded-lg border border-border px-3 py-1.5" />
          <button className="rounded-lg border border-border px-3 py-1.5">Filtrer</button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="pb-2">Date</th><th>Utilisateur</th><th>Action</th><th>Objet</th><th>IP</th><th>Détail</th></tr></thead>
            <tbody className="divide-y divide-border align-top">
              {logs.length === 0 && <tr><td colSpan={6} className="py-6 text-muted">Aucune entrée.</td></tr>}
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(l.at)}</td>
                  <td className="pr-3">{l.actorName}</td>
                  <td className="pr-3 font-mono text-xs">{l.action}</td>
                  <td className="pr-3 text-xs">{l.entityType}<br /><span className="text-muted">{l.entityId.slice(0, 10)}</span></td>
                  <td className="pr-3 text-xs">{l.ip ?? '—'}</td>
                  <td className="max-w-xs text-xs text-muted">
                    <details><summary className="cursor-pointer">voir</summary><pre className="whitespace-pre-wrap">{JSON.stringify({ avant: l.before, après: l.after }, null, 1)}</pre></details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
