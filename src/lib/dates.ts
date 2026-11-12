/** Africa/Lubumbashi = UTC+2 toute l'année (pas d'heure d'été). Dates stockées en UTC (CLAUDE.md). */
const OFFSET_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Jour local (minuit UTC du jour calendaire à Lubumbashi), utilisable comme clé @db.Date. */
export function localDay(date: Date): Date {
  const shifted = date.getTime() + OFFSET_MS;
  return new Date(shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS));
}

/** Dernier instant (inclus) du jour local donné. */
export function localDayEnd(day: Date): Date {
  return new Date(day.getTime() + DAY_MS - OFFSET_MS - 1);
}

/** Parse "YYYY-MM-DD", "DD/MM/YYYY" ou ISO complet. Renvoie null si invalide. */
export function parseFlexibleDate(value: string): Date | null {
  const v = value.trim();
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  const iso = fr ? `${fr[3]}-${fr[2]}-${fr[1]}` : v;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00+02:00`) : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
