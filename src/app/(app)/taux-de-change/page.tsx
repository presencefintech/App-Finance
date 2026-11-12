import { redirect } from 'next/navigation';
import { Forbidden } from '@/components/forbidden';
import { canAccessPath } from '@/lib/navigation';
import { Card, CardTitle } from '@/components/ui/card';
import { RateForm } from '@/components/rate-form';
import { ChartCard, EmptyChart } from '@/components/charts/chart-card';
import { LineChart } from '@/components/charts/line-chart';
import { rateHistory } from '@/server/modules/stats/service';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/server/auth';
import { listRates } from '@/server/modules/fx/service';

export default async function TauxPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath('/taux-de-change', user.roles)) return <Forbidden />;
  const rates = await listRates(user);
  const history = await rateHistory(user, 'USD', 'CDF', 60);
  const canManage = user.roles.some((r) => r.role === 'CONTROLLER');

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <ChartCard className="xl:col-span-2" title="Évolution du taux USD → CDF" subtitle="1 USD en francs congolais · dernière valeur de chaque jour"
        table={{ columns: ['Date', 'Taux'], rows: history.slice(-12).map((h) => [formatDate(h.date), h.rate]) }}>
        {history.length < 2 ? <EmptyChart message="Saisissez au moins deux taux pour voir l’évolution." /> : (
          <LineChart label="Évolution du taux USD vers CDF" categories={history.map((h) => h.date.slice(5))} series={[{ name: '1 USD en CDF', values: history.map((h) => h.rate) }]} />
        )}
      </ChartCard>
      <Card>
        <CardTitle>Historique des taux</CardTitle>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr><th className="pb-2">Date</th><th>Paire</th><th>Taux</th><th>Source</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rates.length === 0 && <tr><td colSpan={4} className="py-6 text-muted">Aucun taux enregistré.</td></tr>}
            {rates.map((r) => (
              <tr key={r.id}>
                <td className="py-2">{formatDate(r.date)}</td>
                <td>1 {r.base} →</td>
                <td className="tabular-nums">{r.rate} {r.quote}</td>
                <td>{r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {canManage && <RateForm />}
    </div>
  );
}
