/**
 * Jauge de consommation : le remplissage porte la gravité (vert → ambre → rouge), la piste est un ton clair
 * du même vert. Seuils d'alerte budgétaire : 80 % et 100 %.
 */
export function Meter({ percent, label, caption }: { percent: number; label: string; caption?: string }) {
  const p = Math.max(0, percent);
  const color = p >= 100 ? 'var(--danger)' : p >= 80 ? 'var(--warning)' : 'var(--series-1)';
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(p))} title={`${label} : ${Math.round(p)} %`}>
      <div className="h-2.5 overflow-hidden rounded-full" style={{ background: 'var(--chart-track)' }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, p)}%`, background: color }} />
      </div>
      {caption && <div className="mt-1 text-xs text-[var(--chart-muted)]">{caption}</div>}
    </div>
  );
}

/** Barre segmentée mince : un tout partagé en parties (ex. remboursé / restant dû). 8 px, bouts arrondis, sans texte. */
export function SegmentedBar({ parts, label }: { parts: { name: string; value: number; color: string }[]; label: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div role="img" aria-label={label} className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
      {total === 0 ? <div className="h-full w-full" style={{ background: 'var(--chart-grid)' }} /> : parts.filter((p) => p.value > 0).map((p) => (
        <div key={p.name} title={`${p.name} : ${Math.round((p.value / total) * 100)} %`} className="h-full" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
      ))}
    </div>
  );
}
