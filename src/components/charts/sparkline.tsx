/** Mini-courbe de tendance pour une tuile de chiffre clé : 12 points maximum, point courant de 8 px cerclé de surface. */
export function Sparkline({ values, color = 'var(--series-1)', label }: { values: number[]; color?: string; label: string }) {
  const w = 96;
  const h = 32;
  const pad = 4;
  if (values.length < 2) return <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-24" role="img" aria-label={label}><line x1={pad} x2={w - pad} y1={h / 2} y2={h / 2} stroke="var(--chart-grid)" /></svg>;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => [pad + ((w - 2 * pad) * i) / (values.length - 1), h - pad - ((v - lo) / span) * (h - 2 * pad)] as const);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-24" role="img" aria-label={label}>
      <title>{label}</title>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={4} fill={color} stroke="var(--card)" strokeWidth={2} />
    </svg>
  );
}
