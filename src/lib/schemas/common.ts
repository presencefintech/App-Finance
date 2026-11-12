import { z } from 'zod';

export const currencySchema = z.enum(['USD', 'CDF']);

/** Montant positif en chaîne, 2 décimales maximum ("1250.00"). Jamais de number. */
export const amountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, 'Montant invalide (2 décimales maximum)')
  .refine((v) => Number(v) > 0, 'Le montant doit être positif');

/** Taux de change : positif, 6 décimales maximum. */
export const rateSchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,6})?$/, 'Taux invalide (6 décimales maximum)')
  .refine((v) => Number(v) > 0, 'Le taux doit être positif');

export const isoDateSchema = z.iso.datetime({ offset: true }).or(z.iso.date());

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}
