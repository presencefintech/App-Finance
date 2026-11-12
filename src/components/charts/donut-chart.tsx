import { colorAt, exactMoney, pct, OTHER_COLOR } from './core';
import { Legend } from './chart-card';

export interface DonutItem { name: string; value: number; color?: string }

const polar = (cx: number, cy: number, r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;

/** Anneau : 6 parts au plus (le reste est regroupé en « Autres »), 2 px de surface entre les parts, total au centre. */
export function DonutChart({
  items, currency, label, centerLabel, centerValue, unit,
}: { items: DonutItem[]; currency?: string; label: string; centerLabel?: string; centerValue?: string; unit?: 'money' | 'count' }) {
  const sorted = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, 6);
  const rest = sorted.slice(6).reduce((s, i) => s + i.value, 0);
  if (rest > 0) head.push({ name: 'Autres', value: rest, color: OTHER_COLOR });
  const total = head.reduce((s, i) => s + i.value, 0);
  const fmt = (v: number) => (unit === 'count' ? String(v) : exactMoney(v, currency));

  const size = 170;
  const cx = size / 2;
  const R = 78;
  const r = 52;
  const sweeps = head.map((it) => (total === 0 ? 0 : (it.value / total) * Math.PI * 2));
  const arcs = head.map((it, i) => {
    const sweep = sweeps[i]!;
    const a0 = -Math.PI / 2 + sweeps.slice(0, i).reduce((a, b) => a + b, 0);
    const a1 = a0 + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const [x0, y0] = polar(cx, cx, R, a0);
    const [x1, y1] = polar(cx, cx, R, a1);
    const [x2, y2] = polar(cx, cx, r, a1);
    const [x3, y3] = polar(cx, cx, r, a0);
    const d = head.length === 1
      ? `M${cx},${cx - R} A${R},${R} 0 1 1 ${cx - 0.01},${cx - R} L${cx - 0.01},${cx - r} A${r},${r} 0 1 0 ${cx},${cx - r} Z`
      : `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${large} 0 ${x3},${y3} Z`;
    return { it, d, color: it.color ?? colorAt(i) };
  });

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="size-40 shrink-0">
        <title>{label}</title>
        {arcs.length === 0 && <circle cx={cx} cy={cx} r={(R + r) / 2} fill="none" stroke="var(--chart-grid)" strokeWidth={R - r} />}
        {arcs.map(({ it, d, color }) => (
          <path key={it.name} d={d} fill={color} stroke="var(--card)" strokeWidth={2} className="transition-opacity hover:opacity-80">
            <title>{`${it.name} : ${fmt(it.value)} (${pct(it.value, total)})`}</title>
          </path>
        ))}
        {centerValue && (
          <>
            <text x={cx} y={cx + 2} textAnchor="middle" fontSize={17} fontWeight={600} fill="var(--foreground)">{centerValue}</text>
            {centerLabel && <text x={cx} y={cx + 17} textAnchor="middle" fontSize={9.5} fill="var(--chart-muted)">{centerLabel}</text>}
          </>
        )}
      </svg>
      <div className="min-w-[10rem] flex-1">
        <Legend items={arcs.map(({ it, color }) => ({ name: it.name, color, value: `${fmt(it.value)} · ${pct(it.value, total)}` }))} />
      </div>
    </div>
  );
}
