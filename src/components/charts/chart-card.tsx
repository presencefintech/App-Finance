import { Card } from '@/components/ui/card';

export interface LegendItem { name: string; color: string; value?: string }

/** Légende : toujours présente dès 2 séries ; le texte reste en encre neutre, la pastille porte la couleur. */
export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--chart-text)]">
      {items.map((i) => (
        <li key={i.name} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: i.color }} />
          {i.name}
          {i.value && <span className="text-[var(--chart-muted)]">{i.value}</span>}
        </li>
      ))}
    </ul>
  );
}

export interface DataTable { columns: string[]; rows: (string | number)[][] }

/** Carte de graphique : titre, sous-titre, graphique, légende, et « vue tableau » (alternative accessible). */
export function ChartCard({
  title, subtitle, legend, table, children, className,
}: {
  title: string; subtitle?: string; legend?: LegendItem[]; table?: DataTable; children: React.ReactNode; className?: string;
}) {
  return (
    <Card className={className}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {subtitle && <p className="mb-3 text-xs text-[var(--chart-muted)]">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      {children}
      {legend && legend.length > 1 && <Legend items={legend} />}
      {table && (
        <details className="mt-3 text-xs text-[var(--chart-text)]">
          <summary className="cursor-pointer text-[var(--chart-muted)]">Voir les données</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full">
              <thead><tr>{table.columns.map((c, i) => <th key={c} className={`pb-1 font-medium ${i === 0 ? 'text-left' : 'text-right'}`}>{c}</th>)}</tr></thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-t border-[var(--chart-grid)]">
                    {r.map((cell, j) => <td key={j} className={`py-1 ${j === 0 ? 'text-left' : 'text-right tabular-nums'}`}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Card>
  );
}

export function EmptyChart({ message = 'Pas encore de données sur la période.' }: { message?: string }) {
  return <p className="py-10 text-center text-sm text-[var(--chart-muted)]">{message}</p>;
}
