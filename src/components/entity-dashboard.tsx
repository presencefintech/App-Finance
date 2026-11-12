import Link from 'next/link';
import { AlertTriangle, CircleAlert } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { BarChart } from '@/components/charts/bar-chart';
import { ChartCard, EmptyChart } from '@/components/charts/chart-card';
import { DonutChart } from '@/components/charts/donut-chart';
import { HBarChart } from '@/components/charts/hbar-chart';
import { Sparkline } from '@/components/charts/sparkline';
import { Money } from '@/components/money';
import { FUND_REQUEST_STATUS, type FundRequestStatusKey } from '@/lib/labels';
import { formatDate } from '@/lib/format';
import type { EntityDashboard } from '@/server/modules/dashboard/service';

type Cur = 'USD' | 'CDF';
interface Props {
  d: EntityDashboard;
  monthly: { label: string; USD: { income: number; expense: number }; CDF: { income: number; expense: number } }[];
  expenseBreakdown: Record<Cur, { name: string; value: number }[]>;
}

function Tile({ label, lines, spark, sparkColor }: { label: string; lines: { currency: Cur; value: string }[]; spark?: number[]; sparkColor?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div>
          {lines.map((l, i) => (
            <div key={l.currency} className={i === 0 ? 'text-xl font-semibold' : 'text-sm text-muted'}>
              <Money value={l.value} currency={l.currency} />
            </div>
          ))}
        </div>
        {spark && <Sparkline values={spark} color={sparkColor} label={`Tendance ${label}`} />}
      </div>
    </div>
  );
}

const sumTo = (rows: { value: number }[]) => rows.reduce((s, r) => s + r.value, 0);

export function EntityDashboardView({ d, monthly, expenseBreakdown }: Props) {
  const usd = d.totals.find((t) => t.currency === 'USD')!;
  const cdf = d.totals.find((t) => t.currency === 'CDF')!;
  const cash = Object.fromEntries(d.cash.map((c) => [c.currency, c.total])) as Record<Cur, string>;
  const bank = Object.fromEntries(d.bank.map((c) => [c.currency, c.total])) as Record<Cur, string>;
  const hasCdf = monthly.some((m) => m.CDF.income > 0 || m.CDF.expense > 0) || Number(cash.CDF) !== 0 || Number(bank.CDF) !== 0;
  const categories = monthly.map((m) => m.label);

  const stat = (c: Cur) => (c === 'USD' ? usd : cdf);
  const currencies: Cur[] = hasCdf ? ['USD', 'CDF'] : ['USD'];

  const balanceSplit = (c: Cur) => [
    { name: 'Caisses', value: Math.max(0, Number(cash[c])) },
    { name: 'Banques', value: Math.max(0, Number(bank[c])) },
  ];

  return (
    <div className="grid gap-4">
      <h2 className="text-lg font-semibold">{d.entity.name}</h2>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Tile label="Recettes du mois" lines={currencies.map((c) => ({ currency: c, value: stat(c).income }))} spark={monthly.map((m) => m.USD.income)} sparkColor="var(--series-1)" />
        <Tile label="Dépenses du mois" lines={currencies.map((c) => ({ currency: c, value: stat(c).expense }))} spark={monthly.map((m) => m.USD.expense)} sparkColor="var(--series-2)" />
        <Tile label="Solde des caisses" lines={currencies.map((c) => ({ currency: c, value: cash[c] }))} />
        <Tile label="Solde des banques" lines={currencies.map((c) => ({ currency: c, value: bank[c] }))} />
      </div>

      {currencies.map((c) => (
        <ChartCard
          key={c}
          title={`Recettes et dépenses — ${c}`}
          subtitle="6 derniers mois · transferts et avances exclus"
          legend={[{ name: 'Recettes', color: 'var(--series-1)' }, { name: 'Dépenses', color: 'var(--series-2)' }]}
          table={{ columns: ['Mois', 'Recettes', 'Dépenses'], rows: monthly.map((m) => [m.label, m[c].income.toFixed(2), m[c].expense.toFixed(2)]) }}
        >
          {monthly.every((m) => m[c].income === 0 && m[c].expense === 0)
            ? <EmptyChart />
            : <BarChart label={`Recettes et dépenses mensuelles en ${c}`} categories={categories} currency={c}
                series={[{ name: 'Recettes', color: 'var(--series-1)', values: monthly.map((m) => m[c].income) }, { name: 'Dépenses', color: 'var(--series-2)', values: monthly.map((m) => m[c].expense) }]} />}
        </ChartCard>
      ))}

      <div className="grid gap-4 md:grid-cols-2">
        {currencies.map((c) => (
          <ChartCard key={c} title={`Répartition des soldes — ${c}`} subtitle="Caisses et banques"
            table={{ columns: ['Type', 'Solde'], rows: balanceSplit(c).map((r) => [r.name, r.value.toFixed(2)]) }}>
            <DonutChart label={`Répartition des soldes ${c}`} items={balanceSplit(c)} currency={c}
              centerValue={Number(Number(cash[c]) + Number(bank[c])).toLocaleString('fr-FR', { notation: 'compact', maximumFractionDigits: 1 })} centerLabel={`total ${c}`} />
          </ChartCard>
        ))}
        <ChartCard title="Demandes de fonds en cours" subtitle="Par statut"
          table={{ columns: ['Statut', 'Nombre'], rows: d.requests.map((r) => [FUND_REQUEST_STATUS[r.status as FundRequestStatusKey]?.label ?? r.status, r.count]) }}>
          {d.requests.length === 0 ? <EmptyChart message="Aucune demande en cours." /> : (
            <DonutChart label="Demandes par statut" unit="count" items={d.requests.map((r) => ({ name: FUND_REQUEST_STATUS[r.status as FundRequestStatusKey]?.label ?? r.status, value: r.count }))}
              centerValue={String(d.requests.reduce((s, r) => s + r.count, 0))} centerLabel="en cours" />
          )}
        </ChartCard>
        {currencies.map((c) => (
          <ChartCard key={c} title={`Dépenses par catégorie — ${c}`} subtitle="Mois courant"
            table={{ columns: ['Catégorie', 'Montant'], rows: expenseBreakdown[c].map((r) => [r.name, r.value.toFixed(2)]) }}>
            {sumTo(expenseBreakdown[c]) === 0 ? <EmptyChart /> : <HBarChart label={`Dépenses par catégorie en ${c}`} currency={c} items={expenseBreakdown[c]} />}
          </ChartCard>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-sm font-semibold">Alertes</h3>
          {d.alerts.length === 0 ? <p className="text-sm text-muted">Aucune alerte.</p> : (
            <ul className="grid gap-2 text-sm">
              {d.alerts.map((a, i) => (
                <li key={i} className="flex items-start gap-2">
                  {a.level === 'danger' ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />}
                  {a.href ? <Link href={a.href} className="hover:underline">{a.text}</Link> : a.text}
                </li>
              ))}
            </ul>
          )}
          <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-xs text-muted">
            <div><dt>Retraits en transit</dt><dd className="text-base font-semibold text-foreground">{d.pendingWithdrawals}</dd></div>
            <div><dt>Écarts de caisse</dt><dd className="text-base font-semibold text-foreground">{d.cashDifferencesPending}</dd></div>
            <div><dt>Rapprochements</dt><dd className="text-base font-semibold text-foreground">{d.reconciliationsPending}</dd></div>
          </dl>
        </Card>
        <Card>
          <h3 className="mb-3 text-sm font-semibold">Opérations bancaires récentes</h3>
          <ul className="divide-y divide-border text-sm">
            {d.recentBank.length === 0 && <li className="py-2 text-muted">Aucune opération.</li>}
            {d.recentBank.map((o) => (
              <li key={o.reference} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0"><span className="block truncate">{o.description}</span><span className="text-xs text-muted">{formatDate(o.date)} · {o.reference}</span></span>
                <Money value={o.amount} currency={o.currency} className="shrink-0 font-medium" />
              </li>
            ))}
          </ul>
          {d.advances && (
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs">
              <div><div className="text-muted">Créances (avances à recevoir)</div>{d.advances.receivable.map((t) => <div key={t.currency}><Money value={t.total} currency={t.currency} className="text-sm font-semibold" /></div>)}</div>
              <div><div className="text-muted">Dettes (avances à rembourser)</div>{d.advances.payable.map((t) => <div key={t.currency}><Money value={t.total} currency={t.currency} className="text-sm font-semibold" /></div>)}</div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
