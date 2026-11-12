import { z } from 'zod';
import { isoDateSchema } from './common';

const col = z.number().int().min(0).max(100);

/** Mapping de colonnes : montant signé OU débit/crédit. */
export const columnMappingSchema = z
  .object({
    hasHeader: z.boolean(),
    date: col,
    label: col,
    reference: col.optional(),
    amount: col.optional(),
    debit: col.optional(),
    credit: col.optional(),
  })
  .refine((m) => m.amount !== undefined || m.debit !== undefined || m.credit !== undefined, 'Indiquez la colonne du montant ou des débit/crédit');

/** Solde (peut être négatif) : chaîne décimale, 2 décimales maximum. */
export const signedAmountSchema = z.string().trim().regex(/^-?\d{1,16}(\.\d{1,2})?$/, 'Montant invalide');

export const importStatementFieldsSchema = z.object({
  accountId: z.string().min(1),
  mapping: z.string().transform((v, ctx) => {
    try { return columnMappingSchema.parse(JSON.parse(v)); }
    catch { ctx.addIssue({ code: 'custom', message: 'Mapping de colonnes invalide' }); return z.NEVER; }
  }),
  openingBalance: signedAmountSchema,
  closingBalance: signedAmountSchema,
  periodStart: isoDateSchema.optional(),
  periodEnd: isoDateSchema.optional(),
});

export const confirmLineSchema = z.object({ entryId: z.string().min(1).optional() });
export const ignoreLineSchema = z.object({ note: z.string().trim().min(3, 'Motif obligatoire').max(300) });
export const createFromLineSchema = z.object({
  categoryId: z.string().min(1).optional(),
  description: z.string().trim().min(3).max(300).optional(),
});
export const validateStatementSchema = z.object({ note: z.string().trim().max(500).optional() });

export type ColumnMappingInput = z.infer<typeof columnMappingSchema>;
