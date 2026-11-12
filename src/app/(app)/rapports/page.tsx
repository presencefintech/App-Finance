import { redirect } from 'next/navigation';
import { Forbidden } from '@/components/forbidden';
import { canAccessPath } from '@/lib/navigation';
import { Card, CardTitle } from '@/components/ui/card';
import { BarChart } from '@/components/charts/bar-chart';
import { ChartCard } from '@/components/charts/chart-card';
import { DonutChart } from '@/components/charts/donut-chart';
import { LineChart } from '@/components/charts/line-chart';
import { Money } from '@/components/money';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/server/auth';
import { getSelectedEntities } from '@/server/entity-selection';
import { AppError } from '@/server/errors';
import { parseDay } from '@/server/files';
import { buildReport, defaultReportRange, REPORT_TYPES, type ReportType } from '@/server/modules/reports/builders';
import type { Section, TabularDoc } from '@/server/modules/reports/types';

const LABELS: Record<ReportType, string> = { daily: 'Journalier', weekly: 'Hebdomadaire', monthly: 'Mensuel' };
type Cur = 'USD' | 'CDF';
const num = (v: string | undefined) => Number(v ?? 0);
const dayInput = (d: Date) => new Date(d.getTime() + 2 * 3600_000).toISOString().slice(0, 10);

/** Graphiques déduits des sections du rapport : toujours une devise par graphique, jamais mélangées. */
function ReportCharts({ doc }: { doc: TabularDoc }) {
  const find = (suffix: string) => doc.sections.filter((s) => s.title.endsWith(suffix));
  const charts: React.ReactNode[] = [];

  for (const s of find('Recettes et dépenses')) {
    const code = s.title.split(' — ')[0];
    const rows = s.rows;
    if (rows.every((r) => num(r.income) === 0 && num(r.expense) === 0)) continue;
    charts.push(
      <ChartCard key={s.title} title={`Recettes et dépenses — ${code}`} subtitle="Période du rapport · par devise" legend={[{ name: 'Recettes', color: 'var(--series-1)' }, { name: 'Dépenses', color: 'var(--series-2)' }]}
        table={{ columns: ['Devise', 'Recettes', 'Dépenses'], rows: rows.map((r) => [r.currency ?? '', r.income ?? '', r.expense ?? '']) }}>
        <BarChart label={`Recettes et dépenses ${code}`} categories={rows.map((r) => r.currency ?? '')} height={200}
          series={[{ name: 'Recettes', color: 'var(--series-1)', values: rows.map((r) => num(r.income)) }, { name: 'Dépenses', color: 'var(--series-2)', values: rows.map((r) => num(r.expense)) }]} />
      </ChartCard>,
    );
  }
  for (const s of find('Dépenses par catégorie')) {
    for (const cur of ['USD', 'CDF'] as Cur[]) {
      const items = s.rows.filter((r) => r.currency === cur).map((r) => ({ name: r.category ?? '', value: num(r.amount) }));
      if (items.length === 0) continue;
      charts.push(
        <ChartCard key={`${s.title}${cur}`} title={`${s.title} — ${cur}`} table={{ columns: ['Catégorie', 'Montant'], rows: items.map((i) => [i.name, i.value.toFixed(2)]) }}>
          <DonutChart label={s.title} items={items} currency={cur} />
        </ChartCard>,
      );
    }
  }
  for (const s of find('Évolution jour par jour')) {
    const days = [...new Set(s.rows.map((r) => r.date ?? ''))];
    for (const cur of ['USD', 'CDF'] as Cur[]) {
      const pick = (k: 'income' | 'expense') => days.map((d) => num(s.rows.find((r) => r.date === d && r.currency === cur)?.[k]));
      if (pick('income').every((v) => v === 0) && pick('expense').every((v) => v === 0)) continue;
      charts.push(
        <ChartCard key={`${s.title}${cur}`} title={`${s.title} — ${cur}`} legend={[{ name: 'Recettes', color: 'var(--series-1)' }, { name: 'Dépenses', color: 'var(--series-2)' }]}
          table={{ columns: ['Jour', 'Recettes', 'Dépenses'], rows: days.map((d, i) => [formatDate(d), pick('income')[i]!.toFixed(2), pick('expense')[i]!.toFixed(2)]) }}>
          <LineChart label={s.title} currency={cur} categories={days.map((d) => formatDate(d).slice(0, 5))} series={[{ name: 'Recettes', color: 'var(--series-1)', values: pick('income') }, { name: 'Dépenses', color: 'var(--series-2)', values: pick('expense') }]} />
        </ChartCard>,
      );
    }
  }
  for (const s of doc.sections.filter((x) => x.title === 'Comparaison des entités')) {
    for (const cur of ['USD', 'CDF'] as Cur[]) {
      const rows = s.rows.filter((r) => r.currency === cur);
      if (rows.length === 0) continue;
      charts.push(
        <ChartCard key={`cmp${cur}`} title={`Comparaison des entités — ${cur}`} subtitle="Côte à côte, sans consolidation" legend={[{ name: 'Recettes', color: 'var(--series-1)' }, { name: 'Dépenses', color: 'var(--series-2)' }]}
          table={{ columns: ['Entité', 'Recettes', 'Dépenses'], rows: rows.map((r) => [r.entity ?? '', r.income ?? '', r.expense ?? '']) }}>
          <BarChart label={`Comparaison des entités en ${cur}`} categories={rows.map((r) => r.entity ?? '')} currency={cur} height={200}
            series={[{ name: 'Recettes', color: 'var(--series-1)', values: rows.map((r) => num(r.income)) }, { name: 'Dépenses', color: 'var(--series-2)', values: rows.map((r) => num(r.expense)) }]} />
        </ChartCard>,
      );
    }
  }
  return charts.length ? <div className="grid gap-4 xl:grid-cols-2">{charts}</div> : null;
}

function SectionTable({ s }: { s: Section }) {
  return (
    <Card>
      <CardTitle>{s.title}</CardTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted"><tr>{s.columns.map((c) => <th key={c.key} className={`pb-2 ${c.type === 'money' || c.type === 'int' ? 'text-right' : ''}`}>{c.label}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">
            {s.rows.length === 0 && <tr><td colSpan={s.columns.length} className="py-4 text-muted">Aucune donnée.</td></tr>}
            {s.rows.map((r, i) => (
              <tr key={i}>
                {s.columns.map((c) => (
                  <td key={c.key} className={`py-1.5 pr-3 ${c.type === 'money' || c.type === 'int' ? 'text-right tabular-nums' : ''}`}>
                    {c.type === 'money' ? <Money value={r[c.key] ?? '0'} currency={(r[c.currencyKey ?? 'currency'] as Cur) ?? 'USD'} />
                      : c.type === 'date' ? formatDate(r[c.key] ?? '') : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.note && <p className="mt-2 text-xs text-muted">{s.note}</p>}
    </Card>
  );
}

export default async function RapportsPage({ searchParams }: { searchParams: Promise<{ type?: string; from?: string; to?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath('/rapports', user.roles)) return <Forbidden />;
  const sp = await searchParams;
  const type = (REPORT_TYPES as readonly string[]).includes(sp.type ?? '') ? (sp.type as ReportType) : 'monthly';
  const def = defaultReportRange(type);
  let from = def.from;
  let to = def.to;
  try {
    from = parseDay(sp.from ?? null, 'start') ?? def.from;
    to = parseDay(sp.to ?? null, 'end') ?? def.to;
  } catch { /* dates invalides : période par défaut */ }

  const { entities, selection } = await getSelectedEntities(user);
  let doc: TabularDoc | null = null;
  let error: string | null = null;
  try {
    doc = await buildReport(user, type, entities.map((e) => e.id), from, to);
  } catch (e) {
    error = e instanceof AppError ? e.message : 'Rapport indisponible';
  }
  const qs = `entity=${selection}&from=${dayInput(from)}&to=${dayInput(to)}`;

  return (
    <div className="grid gap-6">
      <Card>
        <CardTitle>Rapports</CardTitle>
        <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
          <label>Type<select name="type" defaultValue={type} className="ml-2 rounded-lg border border-border px-3 py-1.5">{REPORT_TYPES.map((t) => <option key={t} value={t}>{LABELS[t]}</option>)}</select></label>
          <label>Du<input type="date" name="from" defaultValue={dayInput(from)} className="ml-2 rounded-lg border border-border px-3 py-1.5" /></label>
          <label>Au<input type="date" name="to" defaultValue={dayInput(to)} className="ml-2 rounded-lg border border-border px-3 py-1.5" /></label>
          <button className="rounded-lg bg-primary px-4 py-2 font-medium text-white">Afficher</button>
          {doc && (
            <span className="ml-auto flex gap-2">
              <a className="rounded-lg border border-border px-4 py-2 hover:bg-background" href={`/api/v1/reports/${type}?${qs}&format=pdf`}>Exporter en PDF</a>
              <a className="rounded-lg border border-border px-4 py-2 hover:bg-background" href={`/api/v1/reports/${type}?${qs}&format=xlsx`}>Exporter en Excel</a>
            </span>
          )}
        </form>
        <p className="mt-2 text-xs text-muted">Entité(s) : {selection === 'ALL' ? 'les deux entités, côte à côte' : entities.map((e) => e.name).join(', ')} — changez-les avec le sélecteur en haut de page.</p>
      </Card>
      {error && <Card>{error}</Card>}
      {doc && (
        <>
          <ReportCharts doc={doc} />
          {doc.sections.map((s) => <SectionTable key={s.title} s={s} />)}
        </>
      )}
    </div>
  );
}
