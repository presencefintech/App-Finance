import { z } from 'zod';
import { amountSchema, currencySchema, isoDateSchema, rateSchema } from './common';

export const createAccountSchema = z.object({
  entityId: z.string().min(1),
  type: z.enum(['CASH', 'BANK']),
  name: z.string().trim().min(2).max(120),
  currency: currencySchema,
  bankName: z.string().trim().max(120).optional(),
  holderName: z.string().trim().max(120).optional(),
  accountNumber: z.string().trim().max(60).optional(),
  allowOverdraft: z.boolean().optional(),
  openedAt: isoDateSchema.optional(),
  /** Solde initial : devient une écriture OPENING_BALANCE (règle 3). */
  openingBalance: amountSchema.optional(),
});

export const updateAccountSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  bankName: z.string().trim().max(120).optional(),
  holderName: z.string().trim().max(120).optional(),
  allowOverdraft: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const reverseSchema = z.object({
  reason: z.string().trim().min(5, 'Motif obligatoire (5 caractères minimum)').max(500),
});

export const createRateSchema = z.object({
  date: isoDateSchema,
  base: currencySchema,
  quote: currencySchema,
  rate: rateSchema,
  source: z.string().trim().min(2).max(60),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type CreateRateInput = z.infer<typeof createRateSchema>;
