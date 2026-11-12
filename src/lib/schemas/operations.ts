import { z } from 'zod';
import { amountSchema, currencySchema, isoDateSchema, paginationSchema, rateSchema } from './common';

const paymentMethod = z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'MOBILE_MONEY', 'OTHER']);
const id = z.string().min(1);

export const createIncomeSchema = z.object({
  entityId: id,
  date: isoDateSchema.optional(),
  source: z.string().trim().min(2).max(160),
  categoryId: id,
  amount: amountSchema,
  currency: currencySchema,
  paymentMethod,
  accountId: id,
  note: z.string().trim().max(500).optional(),
});

export const createExpenseSchema = z.object({
  entityId: id,
  date: isoDateSchema.optional(),
  categoryId: id,
  departmentId: id.optional(),
  beneficiary: z.string().trim().min(2).max(160),
  purpose: z.string().trim().min(3).max(500),
  amount: amountSchema,
  currency: currencySchema,
  paymentMethod,
  accountId: id,
});

export const listOperationsSchema = paginationSchema.extend({
  entityId: z.string().optional(),
  categoryId: z.string().optional(),
  departmentId: z.string().optional(),
  currency: currencySchema.optional(),
  beneficiary: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

/** Conversion fournie par l'utilisateur ; la contre-valeur est calculée si absente. */
export const fxInputSchema = z.object({
  rate: rateSchema,
  rateDate: isoDateSchema,
  rateSource: z.string().trim().min(2).max(60),
  toAmount: amountSchema.optional(),
});

export const cashMovementSchema = z.object({
  direction: z.enum(['IN', 'OUT']),
  amount: amountSchema,
  categoryId: id,
  /** Origine (entrée) ou bénéficiaire (sortie). */
  counterparty: z.string().trim().min(2).max(160),
  description: z.string().trim().min(3).max(500),
  date: isoDateSchema.optional(),
});

export const transferSchema = z.object({
  fromAccountId: id,
  toAccountId: id,
  amount: amountSchema,
  description: z.string().trim().max(500).optional(),
  date: isoDateSchema.optional(),
  fx: fxInputSchema.optional(),
});

export const depositSchema = z.object({
  cashAccountId: id,
  bankAccountId: id,
  amount: amountSchema,
  description: z.string().trim().max(500).optional(),
  date: isoDateSchema.optional(),
  fx: fxInputSchema.optional(),
});

export const withdrawalSchema = z.object({
  bankAccountId: id,
  cashAccountId: id,
  amount: amountSchema,
  description: z.string().trim().max(500).optional(),
});

export const bankFeeSchema = z.object({
  bankAccountId: id,
  amount: amountSchema,
  description: z.string().trim().min(3).max(300),
  date: isoDateSchema.optional(),
});

export const cashClosingSchema = z.object({
  date: isoDateSchema.optional(),
  countedBalance: z.string().trim().regex(/^\d{1,16}(\.\d{1,2})?$/, 'Montant invalide'),
  justification: z.string().trim().max(1000).optional(),
  /** Comptage par coupures : { "100": 3, "20": 5 } (valeur faciale → nombre de billets). */
  denominations: z.record(z.string().regex(/^\d+(\.\d{1,2})?$/), z.number().int().min(0).max(1_000_000)).optional(),
});

export const referentialSchema = z.object({
  entityId: id,
  name: z.string().trim().min(2).max(100),
  kind: z.enum(['INCOME', 'EXPENSE']).optional(),
});

export const referentialUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  isActive: z.boolean().optional(),
});

export const importIncomesSchema = z.object({
  entityId: id,
  accountId: id,
  categoryId: id,
  csv: z.string().min(1).max(500_000),
});

export type CreateIncomeInput = z.infer<typeof createIncomeSchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type ListOperationsInput = z.infer<typeof listOperationsSchema>;
export type FxFormInput = z.infer<typeof fxInputSchema>;
export type CashClosingInput = z.infer<typeof cashClosingSchema>;
