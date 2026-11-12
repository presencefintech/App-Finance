const TZ = 'Africa/Lubumbashi';

/** Dates stockées en UTC ; affichage en fuseau Africa/Lubumbashi (CLAUDE.md). */
export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: TZ }).format(
    new Date(value),
  );
}

export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeZone: TZ }).format(new Date(value));
}
