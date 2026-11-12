import { axisLabel, colorAt, exactMoney, ticks, type Series } from './core';

/** Barre à bout supérieur arrondi (4 px), carrée à la ligne de base. */
function topRounded(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/**
 * Colonnes groupées (une barre par série et par catégorie). Une seule échelle, une seule devise :
 * deux devises = deux graphiques. Barres ≤ 24 px, écart de 2 px entre barres jointives.
 */
export function BarChart({
  categories, series, currency, height = 220, label,
}: { categories: string[]; series: Series[]; currency?: string; height?: number; label: string }) {
  const W = 640;
  const m = { l: 52, r: 12, t: 14, b: 28 };
  const plotW = W - m.l - m.r;
  const plotH = height - m.t - m.b;
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const ts = ticks(max);
  const top = ts[ts.length - 1]!;
  const compactAxis = top >= 10_000;
  const band = plotW / Math.max(categories.length, 1);
  const GAP = 2;
  const thick = Math.min(24, (band * 0.72 - GAP * (series.length - 1)) / Math.max(series.length, 1));
  const groupW = thick * series.length + GAP * (series.length - 1);
  const y = (v: number) => m.t + plotH - (v / top) * plotH;

  // Étiquette directe sélective : uniquement le sommet de chaque série (jamais un nombre par barre).
  const peaks = series.map((s) => s.values.indexOf(Math.max(...s.values)));

  return (
    <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label} className="w-full">
      <title>{label}</title>
      {ts.map((t) => (
        <g key={t}>
          <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
          <text x={m.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize={10.5} fill="var(--chart-muted)">{axisLabel(t, compactAxis)}</text>
        </g>
      ))}
      <line x1={m.l} x2={W - m.r} y1={y(0)} y2={y(0)} stroke="var(--chart-axis)" strokeWidth={1} />
      {categories.map((c, ci) => {
        const x0 = m.l + band * ci + (band - groupW) / 2;
        return (
          <g key={c}>
            <text x={m.l + band * ci + band / 2} y={height - 9} textAnchor="middle" fontSize={11} fill="var(--chart-text)">{c}</text>
            {series.map((s, si) => {
              const v = s.values[ci] ?? 0;
              const h = (v / top) * plotH;
              const x = x0 + si * (thick + GAP);
              return (
                <g key={s.name} className="cursor-default [&>path]:transition-opacity [&:hover>path]:opacity-80">
                  <title>{`${c} — ${s.name} : ${exactMoney(v, currency)}`}</title>
                  <path d={topRounded(x, y(v), thick, h)} fill={s.color ?? colorAt(si)} />
                  {/* zone de survol plus large que la marque */}
                  <rect x={x - 2} y={m.t} width={thick + 4} height={plotH} fill="transparent" />
                  {peaks[si] === ci && v > 0 && (
                    <text x={x + thick / 2} y={y(v) - 5} textAnchor="middle" fontSize={10.5} fill="var(--chart-text)" fontWeight={600}>{axisLabel(v, true)}</text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
