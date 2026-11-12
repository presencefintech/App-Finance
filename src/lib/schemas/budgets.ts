import { z } from 'zod';
import { amountSchema, currencySchema, isoDateSchema } from './common';

export const budgetLineSchema = z
  .object({
    departmentId: z.string().min(1).optional(),
    categoryId: z.string().min(1).optional(),
    amount: amountSchema,
  })
  .refine((l) => l.departmentId || l.categoryId, 'Une ligne porte sur un département et/ou une catégorie');

export const createBudgetSchema = z.object({
  entityId: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  currency: currencySchema,
  lines: z.array(budgetLineSchema).min(1, 'Au moins une ligne').max(100),
});

export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;
