import Link from 'next/link';
import { Forbidden } from '@/components/forbidden';
import { canAccessPath } from '@/lib/navigation';
import { redirect } from 'next/navigation';
import { Card, CardTitle } from '@/components/ui/card';
import { BudgetForm } from '@/components/budget-form';
import { Money } from '@/components/money';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { getCurrentUser } from '@/server/auth';
import { getSelectedEntities } from '@/server/entity-selection';
import { listBudgets, treasuryForecast } from '@/server/modules/budgets/service';
import { listCategories, listDepartments } from '@/server/modules/referentials/service';

export default async function BudgetsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath('/budgets', user.roles)) return <Forbidden />;
  const { entities } = await getSelectedEntities(user);
  const all = await listBudgets(user);
  const manageable = entities.filter((e) => can(user.roles, 'budget.manage', e.id));
  const [deps, cats] = await Promise.all([listDepartments(user), listCategories(user)]);

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 xl:grid-cols-2">
        {await Promise.all(
          entities.map(async (entity) => {
            const forecast = await treasuryForecast(user, entity.id).catch(() => []);
            const rows = all.filter((b) => b.entityId === entity.id);
            return (
              <Card key={entity.id}>
                <CardTitle>Budgets — {entity.name}</CardTitle>
                <ul className="divide-y divide-border text-sm">
                  {rows.length === 0 && <li className="py-4 text-muted">Aucun budget.</li>}
                  {rows.map((b) => (
                    <li key={b.id} className="flex items-center justify-between py-3">
                      <div>
                        <Link href={`/budgets/${b.id}`} className="font-medium hover:text-primary">{b.name}</Link>
                        <div className="text-xs text-muted">{formatDate(b.periodStart)} → {formatDate(b.periodEnd)} · {b.lines} ligne(s)</div>
                      </div>
                      <Money value={b.total} currency={b.currency} className="font-semibold" />
                    </li>
                  ))}
                </ul>
                {forecast.length > 0 && (
                  <div className="mt-4 border-t border-border pt-3">
                    <h3 className="mb-2 text-sm font-semibold">Prévision de trésorerie (1 semaine)</h3>
                    {forecast.map((f) => (
                      <div key={f.currency} className="mb-1 text-xs text-muted">
                        {f.currency} : solde <Money value={f.balance} currency={f.currency} /> − engagé <Money value={f.committed} currency={f.currency} /> + recettes moy./sem.{' '}
                        <Money value={f.avgWeeklyIncome} currency={f.currency} /> = <Money value={f.projected} currency={f.currency} className="font-semibold text-foreground" />
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          }),
        )}
      </div>
      {manageable.length > 0 && (
        <BudgetForm
          entities={manageable}
          departments={deps.map((d) => ({ id: d.id, entityId: d.entityId, name: d.name }))}
          categories={cats.filter((c) => c.kind === 'EXPENSE').map((c) => ({ id: c.id, entityId: c.entityId, name: c.name }))}
        />
      )}
    </div>
  );
}
