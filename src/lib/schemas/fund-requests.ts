import { z } from 'zod';
import { amountSchema, currencySchema, paginationSchema } from './common';

const FUND_REQUEST_STATUSES = [
  'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ESCALATED', 'APPROVED', 'REJECTED',
  'DISBURSED', 'RECEIVED', 'JUSTIFIED', 'CLOSED', 'CANCELLED',
] as const;
export type FundRequestStatusValue = (typeof FUND_REQUEST_STATUSES)[number];

export const createFundRequestSchema = z.object({
  entityId: z.string().min(1),
  departmentId: z.string().min(1).optional(),
  amount: amountSchema,
  currency: currencySchema,
  purpose: z.string().trim().min(10, 'Décrivez le motif (10 caractères minimum)').max(2000),
  /** true = soumettre immédiatement ; sinon brouillon. */
  submit: z.boolean().optional(),
});

export const updateFundRequestSchema = z.object({
  departmentId: z.string().min(1).nullable().optional(),
  amount: amountSchema.optional(),
  currency: currencySchema.optional(),
  purpose: z.string().trim().min(10).max(2000).optional(),
});

export const commentSchema = z.object({ comment: z.string().trim().max(1000).optional() });
export const rejectSchema = z.object({ comment: z.string().trim().min(3, 'Commentaire obligatoire').max(1000) });
export const disburseSchema = z.object({
  accountId: z.string().min(1),
  categoryId: z.string().min(1).optional(),
  /** Obligatoire pour décaisser depuis un compte de l'autre entité (avance inter-entités). */
  confirmAdvance: z.boolean().optional(),
});

export const listFundRequestsSchema = paginationSchema.extend({
  entityId: z.string().optional(),
  status: z.enum(FUND_REQUEST_STATUSES).optional(),
  requesterId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export type CreateFundRequestInput = z.infer<typeof createFundRequestSchema>;
export type UpdateFundRequestInput = z.infer<typeof updateFundRequestSchema>;
export type ListFundRequestsInput = z.infer<typeof listFundRequestsSchema>;
