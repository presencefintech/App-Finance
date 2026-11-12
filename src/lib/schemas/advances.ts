import { z } from 'zod';
import { amountSchema, isoDateSchema } from './common';
import { fxInputSchema } from './operations';

const id = z.string().min(1);

export const createAdvanceSchema = z.object({
  lenderAccountId: id,
  borrowerEntityId: id,
  amount: amountSchema,
  beneficiary: z.string().trim().min(2).max(160),
  purpose: z.string().trim().min(3).max(500),
  categoryId: id.optional(),
  date: isoDateSchema.optional(),
});

/**
 * Remboursement : `amount` est exprimé dans la devise de l'avance.
 * Si le compte payeur est dans l'autre devise, `fromAmount` (montant débité) et `fx` sont obligatoires.
 */
export const repaymentSchema = z.object({
  fromAccountId: id,
  toAccountId: id,
  amount: amountSchema,
  fromAmount: amountSchema.optional(),
  fx: fxInputSchema.optional(),
  date: isoDateSchema.optional(),
});

export type CreateAdvanceInput = z.infer<typeof createAdvanceSchema>;
export type RepaymentInput = z.infer<typeof repaymentSchema>;
