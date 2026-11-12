import 'server-only';
import { Prisma } from '@/generated/prisma/client';

/** Prisma.Decimal = decimal.js. Jamais de number pour un montant (règle 1). */
export type Money = Prisma.Decimal;

/** Entrée volontairement limitée aux chaînes et Decimal : jamais de number (règle 1). */
export const D = (value: string | Money): Money => new Prisma.Decimal(value);
export const ZERO: Money = D('0');

/** Arrondi bancaire à 2 décimales (montants) — ROUND_HALF_UP. */
export const round2 = (value: Money): Money => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** Représentation JSON : toujours une chaîne à 2 décimales ("1250.00"). */
export const toMoneyString = (value: Money): string => value.toFixed(2);

export const sum = (values: Money[]): Money => values.reduce((a, b) => a.plus(b), ZERO);
