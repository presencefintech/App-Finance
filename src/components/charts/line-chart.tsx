import { axisLabel, colorAt, exactMoney, niceMax, type Series } from './core';

/**
 * Courbe(s) 2 px avec aire à ~10 % d'opacité, point final de 8 px cerclé de 2 px de la couleur de surface,
 * étiquette directe sur le dernier point uniquement, survol par colonne (info-bulle).
 * Les valeurs peuvent être négatives (solde) ; l'axe s'adapte.
 */
export function LineChart({
  categories, series, currency, height = 200, label, area = true, tickEvery,
}: { categories: string[]; series: Series[]; currency?: string; height?: number; label: string; area?: boolean; tickEvery?: number }) {
  const W = 640;
  const m = { l: 52, r: 46, t: 14, b: 26 };
  const plotW = W - m.l - m.r;
  const plotH = height - m.t - m.b;
  const all = series.flatMap((s) => s.values);
  const maxV = Math.max(0, ...all);
  const minV = Math.min(0, ...all);
  // Axe à pas « propre » (1, 2, 2.5, 5 × 10^n), valable avec des valeurs négatives (soldes).
  const step = niceMax(((maxV - minV) || 1) / 4);
  const lo = Math.floor(minV / step) * step;
  const hi = Math.ceil(maxV / step) * step || step;
  const ts: number[] = [];
  for (let t = lo; t <= hi + step / 1000; t += step) ts.push(t);
  const span = hi - lo || 1;
  const n = categories.length;
  const x = (i: number) => m.l + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const y = (v: number) => m.t + plotH - ((v - lo) / span) * plotH;
  const labelEvery = tickEvery ?? Math.max(1, Math.ceil(n / 6));
  const compactAxis = Math.max(Math.abs(hi), Math.abs(lo)) >= 10_000;

  return (
    <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label} className="w-full">
      <title>{label}</title>
      {ts.map((t) => (
        <g key={t}>
          <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'} strokeWidth={1} />
          <text x={m.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize={10.5} fill="var(--chart-muted)">{axisLabel(t, compactAxis)}</text>
        </g>
      ))}
      {categories.map((c, i) => i % labelEvery === 0 && (
        <text key={c + i} x={x(i)} y={height - 8} textAnchor="middle" fontSize={10.5} fill="var(--chart-text)">{c}</text>
      ))}
      {series.map((s, si) => {
        const color = s.color ?? colorAt(si);
        const pts = s.values.map((v, i) => [x(i), y(v)] as const);
        const d = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
        const last = pts[pts.length - 1];
        const lastV = s.values[s.values.length - 1];
        return (
          <g key={s.name}>
            {area && pts.length > 1 && <path d={`${d} L${pts[pts.length - 1]![0]},${y(Math.max(lo, 0))} L${pts[0]![0]},${y(Math.max(lo, 0))} Z`} fill={color} opacity={0.1} />}
            <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {last && lastV !== undefined && (
              <>
                <circle cx={last[0]} cy={last[1]} r={4} fill={color} stroke="var(--card)" strokeWidth={2} />
                <text x={last[0] + 8} y={last[1] + 3.5} fontSize={10.5} fontWeight={600} fill="var(--chart-text)">{axisLabel(lastV, true)}</text>
              </>
            )}
          </g>
        );
      })}
      {/* survol : une bande par point (info-bulle native listant toutes les séries) */}
      {categories.map((c, i) => (
        <rect key={`h${i}`} x={x(i) - plotW / Math.max(n - 1, 1) / 2} y={m.t} width={plotW / Math.max(n - 1, 1)} height={plotH} fill="transparent" className="hover:fill-[var(--chart-grid)]/40">
          <title>{`${c}\n${series.map((s) => `${s.name} : ${exactMoney(s.values[i] ?? 0, currency)}`).join('\n')}`}</title>
        </rect>
      ))}
    </svg>
  );
}
