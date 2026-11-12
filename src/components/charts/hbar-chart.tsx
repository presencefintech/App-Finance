import { axisLabel, colorAt, exactMoney, pct } from './core';

export interface HBarItem { name: string; value: number; color?: string }

/** Classement horizontal (catégories, comptes) : valeur au bout de la barre, libellés en encre neutre. */
export function HBarChart({
  items, currency, label, limit = 7,
}: { items: HBarItem[]; currency?: string; label: string; limit?: number }) {
  const sorted = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, limit);
  const rest = sorted.slice(limit).reduce((s, i) => s + i.value, 0);
  if (rest > 0) head.push({ name: 'Autres', value: rest, color: 'var(--series-other)' });
  const total = sorted.reduce((s, i) => s + i.value, 0);
  const max = Math.max(1, ...head.map((i) => i.value));

  return (
    <ul role="img" aria-label={label} className="grid gap-2.5">
      {head.map((it, i) => (
        <li key={it.name} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-xs" title={`${it.name} : ${exactMoney(it.value, currency)} (${pct(it.value, total)})`}>
          <span className="truncate text-[var(--chart-text)]">{it.name}</span>
          <span className="h-3 rounded-r-[4px] rounded-l-none bg-transparent">
            <span
              className="block h-3 rounded-r-[4px]"
              style={{ width: `${Math.max(2, (it.value / max) * 100)}%`, background: it.color ?? (it.name === 'Autres' ? 'var(--series-other)' : colorAt(0)) }}
              data-i={i}
            />
          </span>
          <span className="tabular-nums text-[var(--chart-text)]">{axisLabel(it.value, it.value >= 10_000)} <span className="text-[var(--chart-muted)]">· {pct(it.value, total)}</span></span>
        </li>
      ))}
    </ul>
  );
}
