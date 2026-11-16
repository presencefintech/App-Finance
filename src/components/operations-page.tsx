import { redirect } from 'next/navigation';
import { Paperclip } from 'lucide-react';
import { Forbidden } from '@/components/forbidden';
import { canAccessPath } from '@/lib/navigation';
import { Card, CardTitle } from '@/components/ui/card';
import { Money } from '@/components/money';
import { OperationForm } from '@/components/operation-form';
import { BarChart } from '@/components/charts/bar-chart';
import { ChartCard, EmptyChart } from '@/components/charts/chart-card';
import { DonutChart } from '@/components/charts/donut-chart';
import { monthlySeries, recentBreakdown } from '@/server/modules/stats/service';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { getCurrentUser } from '@/server/auth';
import { getSelectedEntities } from '@/server/entity-selection';
import { prisma } from '@/server/db';
import { evidenceCountsByReference } from '@/server/modules/attachments/service';
import { listExpenses } from '@/server/modules/expenses/service';
import { listIncomes } from '@/server/modules/incomes/service';

/** Liste des recettes ou des dépenses, par entité (jamais fusionnées). */
export async function OperationsPage({ kind }: { kind: 'income' | 'expense' }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath(kind === 'income' ? '/recettes' : '/depenses', user.roles)) return <Forbidden />;
  const { entities } = await getSelectedEntities(user);
  const cats = await prisma.category.findMany({ where: { entityId: { in: entities.map((e) => e.id) } } });
  const catName = new Map(cats.map((c) => [c.id, c.name]));

  const sections = await Promise.all(
    entities.map(async (entity) => {
      const q = { entityId: entity.id, page: 1, pageSize: 50 };
      const result = kind === 'income' ? await listIncomes(user, q) : await listExpenses(user, q);
      const [breakdown, monthly] = await Promise.all([
        recentBreakdown(user, entity.id, kind === 'income' ? 'INCOME' : 'EXPENSE', 90),
        monthlySeries(user, entity.id, 6),
      ]);
      const evidence = await evidenceCountsByReference(user, entity.id, result.data.map((r) => r.reference));
      return { entity, rows: result.data, total: result.total, breakdown, monthly, evidence };
    }),
  );
  const recordable = entities.filter((e) => can(user.roles, 'transaction.record', e.id));

  return (
    <div className="grid gap-6">
      {sections.map(({ entity, rows, total, breakdown, monthly, evidence }) => (
        <div key={entity.id} className="grid gap-4">
        <div className="grid gap-4 xl:grid-cols-2">
          {(['USD', 'CDF'] as const).map((cur) => {
            const key = kind === 'income' ? 'income' : 'expense';
            const has = monthly.some((m) => m[cur][key] > 0);
            if (!has && cur === 'CDF') return null;
            return (
              <ChartCard key={cur} title={`${kind === 'income' ? 'Recettes' : 'Dépenses'} par mois — ${entity.code} · ${cur}`} subtitle="6 derniers mois"
                legend={[{ name: kind === 'income' ? 'Recettes' : 'Dépenses', color: kind === 'income' ? 'var(--series-1)' : 'var(--series-2)' }]}
                table={{ columns: ['Mois', 'Montant'], rows: monthly.map((m) => [m.label, m[cur][key].toFixed(2)]) }}>
                {has ? <BarChart label={`${kind === 'income' ? 'Recettes' : 'Dépenses'} mensuelles en ${cur}`} categories={monthly.map((m) => m.label)} currency={cur} series={[{ name: kind === 'income' ? 'Recettes' : 'Dépenses', color: kind === 'income' ? 'var(--series-1)' : 'var(--series-2)', values: monthly.map((m) => m[cur][key]) }]} /> : <EmptyChart />}
              </ChartCard>
            );
          })}
          {(['USD', 'CDF'] as const).map((cur) => breakdown[cur].length === 0 ? null : (
            <ChartCard key={cur} title={`Répartition par catégorie — ${entity.code} · ${cur}`} subtitle="90 derniers jours" table={{ columns: ['Catégorie', 'Montant'], rows: breakdown[cur].map((b) => [b.name, b.value.toFixed(2)]) }}>
              <DonutChart label={`Répartition par catégorie en ${cur}`} items={breakdown[cur]} currency={cur} />
            </ChartCard>
          ))}
        </div>
        <Card>
          <CardTitle>{kind === 'income' ? 'Recettes' : 'Dépenses'} — {entity.name} <span className="text-sm font-normal text-muted">({total})</span></CardTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr><th className="pb-2">Date</th><th>Référence</th><th>Catégorie</th><th>{kind === 'income' ? 'Origine' : 'Bénéficiaire'}</th><th className="text-right">Montant</th><th className="pl-3 text-center">Justificatif</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 && <tr><td colSpan={6} className="py-6 text-muted">Aucune opération.</td></tr>}
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-3">{formatDate(r.date)}</td>
                    <td className="pr-3 font-mono text-xs">{r.reference}</td>
                    <td className="pr-3">{catName.get(r.categoryId) ?? '—'}</td>
                    <td className="pr-3">{'source' in r ? r.source : r.beneficiary}</td>
                    <td className="text-right"><Money value={r.amount} currency={r.currency} /></td>
                    <td className="pl-3 text-center"><EvidenceBadge count={evidence.get(r.reference) ?? 0} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        </div>
      ))}
      {recordable.length > 0 && <OperationForm kind={kind} entities={recordable} />}
    </div>
  );
}

/** Trombone avec le nombre de justificatifs ; tiret si aucun. */
function EvidenceBadge({ count }: { count: number }) {
  if (count === 0) return <span className="text-muted" title="Aucun justificatif">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-primary" title={`${count} justificatif${count > 1 ? 's' : ''}`}>
      <Paperclip className="size-4" aria-hidden /> {count}<span className="sr-only"> justificatif{count > 1 ? 's' : ''}</span>
    </span>
  );
}
