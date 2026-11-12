import { redirect } from 'next/navigation';
import { canAccessPath, landingPath } from '@/lib/navigation';
import { Card } from '@/components/ui/card';
import { EntityDashboardView } from '@/components/entity-dashboard';
import { localDay } from '@/lib/dates';
import { getCurrentUser } from '@/server/auth';
import { dashboard } from '@/server/modules/dashboard/service';
import { getSelectedEntities } from '@/server/entity-selection';
import { categoryBreakdown, monthlySeries } from '@/server/modules/stats/service';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // Un rôle sans accès au tableau de bord (ex. demandeur) atterrit sur sa première page autorisée.
  if (!canAccessPath('/', user.roles, user.isPlatformAdmin)) redirect(landingPath(user.roles, user.isPlatformAdmin));
  const { entities, selection } = await getSelectedEntities(user);
  const data = await dashboard(user, entities.map((e) => e.id));
  if (data.length === 0) return <Card>Aucune donnée financière n’est accessible avec vos droits.</Card>;

  const today = localDay(new Date());
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1) - 2 * 3600_000);
  const to = new Date();
  // Une colonne par entité en vue consolidée : jamais fusionnées, chaque devise sur son propre graphique.
  const views = await Promise.all(
    data.map(async (d) => ({
      d,
      monthly: await monthlySeries(user, d.entity.id, 6),
      expenseBreakdown: await categoryBreakdown(user, d.entity.id, 'EXPENSE', from, to),
    })),
  );

  return (
    <div className="grid gap-8">
      {selection === 'ALL' && views.length > 1 && (
        <p className="text-sm text-muted">Vue consolidée : les entités sont affichées côte à côte, par devise, sans jamais être fusionnées.</p>
      )}
      <div className={`grid items-start gap-8 ${views.length > 1 ? '2xl:grid-cols-2' : ''}`}>
        {views.map((v) => <EntityDashboardView key={v.d.entity.id} d={v.d} monthly={v.monthly} expenseBreakdown={v.expenseBreakdown} />)}
      </div>
    </div>
  );
}
