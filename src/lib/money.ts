import type { Currency } from '@/generated/prisma/enums';

const SYMBOLS: Record<Currency, string> = { USD: 'USD', CDF: 'CDF' };

/** Formate une chaîne décimale ("1250.00") en "1 250,00 USD". Aucun number JS pour les montants. */
export function formatMoney(value: string, currency: Currency): string {
  const [intRaw = '0', frac = ''] = value.replace('-', '').split('.');
  const int = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
  const sign = value.startsWith('-') ? '-' : '';
  return `${sign}${int},${frac.padEnd(2, '0').slice(0, 2)} ${SYMBOLS[currency]}`;
}
