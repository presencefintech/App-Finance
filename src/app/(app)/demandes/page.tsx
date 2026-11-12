import Link from 'next/link';
import { Forbidden } from '@/components/forbidden';
import { canAccessPath } from '@/lib/navigation';
import { redirect } from 'next/navigation';
import { Card, CardTitle } from '@/components/ui/card';
import { FundRequestStatus } from '@/components/fund-request-status';
import { Money } from '@/components/money';
import { BarChart } from '@/components/charts/bar-chart';
import { ChartCard, EmptyChart } from '@/components/charts/chart-card';
import { DonutChart } from '@/components/charts/donut-chart';
import { requestStats } from '@/server/modules/stats/service';
import { FUND_REQUEST_STATUS } from '@/lib/labels';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { getCurrentUser } from '@/server/auth';
import { getSelectedEntities } from '@/server/entity-selection';
import { listFundRequests } from '@/server/modules/fund-requests/service';
import type { FundRequestStatusValue } from '@/lib/schemas/fund-requests';

export default async function DemandesPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath('/demandes', user.roles)) return <Forbidden />;
  const sp = await searchParams;
  const { entities } = await getSelectedEntities(user);
  const status = sp.status && sp.status in FUND_REQUEST_STATUS ? (sp.status as FundRequestStatusValue) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);

  // Une requête par entité : la vue consolidée affiche les entités côte à côte, jamais fusionnées.
  const sections = await Promise.all(
    entities.map(async (entity) => ({
      entity,
      result: await listFundRequests(user, { entityId: entity.id, status, page, pageSize: 25 }),
    })),
  );
  const stats = await requestStats(user, entities.map((e) => e.id), 6);
  const statusItems = stats.byStatus.map((s) => ({ name: FUND_REQUEST_STATUS[s.status as keyof typeof FUND_REQUEST_STATUS]?.label ?? s.status, value: s.count }));
  const totalReq = stats.byStatus.reduce((a, s) => a + s.count, 0);
  const canCreate = entities.some((e) => can(user.roles, 'fundRequest.create', e.id));

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 text-sm">
          <Link href="/demandes" className={`rounded-full px-3 py-1 ${!status ? 'bg-primary text-white' : 'border border-border'}`}>Toutes</Link>
          {(Object.keys(FUND_REQUEST_STATUS) as (keyof typeof FUND_REQUEST_STATUS)[]).map((s) => (
            <Link key={s} href={`/demandes?status=${s}`} className={`rounded-full px-3 py-1 ${status === s ? 'bg-primary text-white' : 'border border-border'}`}>
              {FUND_REQUEST_STATUS[s].label}
            </Link>
          ))}
        </div>
        {canCreate && (
          <Link href="/demandes/nouvelle" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white">Nouvelle demande</Link>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title="Demandes par statut" subtitle="Toutes périodes" table={{ columns: ['Statut', 'Nombre'], rows: statusItems.map((s) => [s.name, s.value]) }}>
          {totalReq === 0 ? <EmptyChart message="Aucune demande." /> : <DonutChart label="Demandes par statut" unit="count" items={statusItems} centerValue={String(totalReq)} centerLabel="demandes" />}
        </ChartCard>
        <ChartCard title="Demandes créées par mois" subtitle="6 derniers mois" legend={[{ name: 'Demandes', color: 'var(--series-3)' }]} table={{ columns: ['Mois', 'Demandes'], rows: stats.monthly.map((m) => [m.label, m.count]) }}>
          {stats.monthly.every((m) => m.count === 0) ? <EmptyChart /> : <BarChart label="Demandes créées par mois" categories={stats.monthly.map((m) => m.label)} series={[{ name: 'Demandes', color: 'var(--series-3)', values: stats.monthly.map((m) => m.count) }]} />}
        </ChartCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-1">
        {sections.map(({ entity, result }) => (
          <Card key={entity.id}>
            <CardTitle>Demandes de fonds — {entity.name}</CardTitle>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr><th className="pb-2">Référence</th><th>Demandeur</th><th>Motif</th><th className="text-right">Montant</th><th>Date</th><th>Statut</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.data.length === 0 && <tr><td colSpan={6} className="py-6 text-muted">Aucune demande.</td></tr>}
                  {result.data.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-3"><Link href={`/demandes/${r.id}`} className="font-mono text-xs hover:text-primary">{r.reference}</Link></td>
                      <td className="pr-3">{r.requesterName}</td>
                      <td className="max-w-xs truncate pr-3">{r.purpose}</td>
                      <td className="pr-3 text-right"><Money value={r.amount} currency={r.currency} /></td>
                      <td className="pr-3">{formatDate(r.createdAt)}</td>
                      <td><FundRequestStatus status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.total > result.pageSize && (
              <p className="mt-3 text-xs text-muted">
                Page {result.page} · {result.total} demandes ·{' '}
                {page > 1 && <Link className="underline" href={`/demandes?${status ? `status=${status}&` : ''}page=${page - 1}`}>précédente</Link>}{' '}
                {page * result.pageSize < result.total && <Link className="underline" href={`/demandes?${status ? `status=${status}&` : ''}page=${page + 1}`}>suivante</Link>}
              </p>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
