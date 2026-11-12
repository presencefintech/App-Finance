import { notFound, redirect } from 'next/navigation';
import { Forbidden } from '@/components/forbidden';
import { canAccessPath } from '@/lib/navigation';
import { Card, CardTitle } from '@/components/ui/card';
import { Money } from '@/components/money';
import { BarChart } from '@/components/charts/bar-chart';
import { ChartCard } from '@/components/charts/chart-card';
import { Meter } from '@/components/charts/meter';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/server/auth';
import { AppError } from '@/server/errors';
import { budgetExecution } from '@/server/modules/budgets/service';


export default async function BudgetDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath('/budgets', user.roles)) return <Forbidden />;
  const { id } = await params;
  let b;
  try {
    b = await budgetExecution(user, id);
  } catch (e) {
    if (e instanceof AppError && e.httpStatus === 404) notFound();
    throw e;
  }
  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <Card>
        <h1 className="text-xl font-semibold">{b.name}</h1>
        <p className="text-sm text-muted">{formatDate(b.periodStart)} → {formatDate(b.periodEnd)} · {b.currency}</p>
      </Card>
      <ChartCard
        title="Budget, engagé et réalisé par ligne" subtitle={`Période du budget · ${b.currency}`}
        legend={[{ name: 'Budget', color: 'var(--series-3)' }, { name: 'Engagé', color: 'var(--series-4)' }, { name: 'Réalisé', color: 'var(--series-2)' }]}
        table={{ columns: ['Ligne', 'Budget', 'Engagé', 'Réalisé'], rows: b.lines.map((l) => [l.label || 'Ensemble', l.budget, l.committed, l.realised]) }}
      >
        <BarChart label="Budget, engagé et réalisé par ligne" currency={b.currency} categories={b.lines.map((l) => l.label || 'Ensemble')}
          series={[{ name: 'Budget', color: 'var(--series-3)', values: b.lines.map((l) => Number(l.budget)) }, { name: 'Engagé', color: 'var(--series-4)', values: b.lines.map((l) => Number(l.committed)) }, { name: 'Réalisé', color: 'var(--series-2)', values: b.lines.map((l) => Number(l.realised)) }]} />
      </ChartCard>
      <Card>
        <CardTitle>Exécution par ligne</CardTitle>
        <ul className="grid gap-5">
          {b.lines.map((l) => (
            <li key={l.id}>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{l.label || 'Ensemble'}</span>
                <span className="text-xs text-muted">
                  Budget <Money value={l.budget} currency={b.currency} /> · engagé <Money value={l.committed} currency={b.currency} /> · réalisé{' '}
                  <Money value={l.realised} currency={b.currency} /> · disponible <Money value={l.available} currency={b.currency} className="font-semibold text-foreground" />
                </span>
              </div>
              <Meter label={`${l.label || 'Ensemble'} : consommation du budget`} percent={l.percentConsumed} />
              <div className="mt-1 text-xs text-muted">
                {l.percentConsumed} % consommé
                {l.alert === 'WARN_80' && <span className="ml-2 text-warning">⚠ seuil de 80 % atteint</span>}
                {l.alert === 'OVER_100' && <span className="ml-2 text-danger">⚠ budget dépassé</span>}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-xs text-muted">
          L’engagé correspond aux demandes approuvées non encore décaissées, rattachées à un département. Une ligne portant
          uniquement sur une catégorie ne reçoit pas d’engagement (les demandes n’ont pas de catégorie).
        </p>
      </Card>
    </div>
  );
}
