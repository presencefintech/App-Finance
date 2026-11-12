/**
 * Utilitaires de tracé. IMPORTANT : ces `number` ne servent QU'À la géométrie et à l'affichage des graphiques ;
 * aucun calcul comptable ne passe par ici (les montants restent des chaînes décimales côté serveur, règle 1).
 */
export const SERIES_COLORS = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)',
] as const;
export const OTHER_COLOR = 'var(--series-other)';

/** Couleur par entité (jamais par rang) : un filtre qui retire une série ne repeint pas les autres. */
export const colorAt = (i: number) => SERIES_COLORS[i] ?? OTHER_COLOR;

/** Valeur arrondie « propre » pour l'axe : 1, 2, 5 × 10^n. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const exp = Math.floor(Math.log10(max));
  const base = 10 ** exp;
  for (const m of [1, 2, 2.5, 5, 10]) if (m * base >= max) return m * base;
  return 10 * base;
}

export function ticks(max: number, count = 4): number[] {
  const top = niceMax(max);
  return Array.from({ length: count + 1 }, (_, i) => (top / count) * i);
}

const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const exact = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Étiquette d'axe : en entier sous 10 000, compacte au-delà (une seule règle par axe). */
export const axisLabel = (v: number, compactAxis: boolean) => (compactAxis ? compact.format(v) : full.format(v));
export const exactMoney = (v: number, currency?: string) => `${exact.format(v).replace(/[  ]/g, ' ')}${currency ? ` ${currency}` : ''}`;
export const pct = (part: number, total: number) => (total === 0 ? '0 %' : `${Math.round((part / total) * 100)} %`);

export const toNum = (v: string | number): number => (typeof v === 'number' ? v : Number(v));

export interface Series { name: string; color?: string; values: number[] }
