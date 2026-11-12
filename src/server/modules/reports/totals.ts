import 'server-only';
import type { Currency } from '@/generated/prisma/enums';
import { prisma } from '@/server/db';
import { D, ZERO, toMoneyString, type Money } from '@/server/money';

export interface PeriodTotals {
  currency: Currency;
  income: string;
  expense: string;
}

/**
 * Totaux recettes / dépenses d'une entité, PAR DEVISE (jamais additionnés entre devises).
 * Recettes : INCOME. Dépenses : EXPENSE + BANK_FEE.
 * Exclus (règles 6 et 7) : transferts, avances, remboursements, soldes d'ouverture, écarts de caisse.
 * Une opération contre-passée (status REVERSED) et sa contre-passation sont toutes deux ignorées : effet net nul.
 */
export async function periodTotals(entityId: string, from: Date, to: Date): Promise<PeriodTotals[]> {
  const rows = await prisma.$queryRaw<{ currency: Currency; kind: string; total: string }[]>`
    SELECT e."currency" AS currency, t."kind"::text AS kind, SUM(e."amount")::text AS total
    FROM "LedgerEntry" e
    JOIN "FinancialTransaction" t ON t."id" = e."txId"
    WHERE t."entityId" = ${entityId}
      AND t."status" = 'POSTED'
      AND t."kind" IN ('INCOME', 'EXPENSE', 'BANK_FEE')
      AND t."date" >= ${from} AND t."date" <= ${to}
    GROUP BY e."currency", t."kind"`;
  // Dépenses de l'entité EMPRUNTEUSE payées par une avance : elles lui reviennent (règle 7), alors que le
  // décaissement (ADVANCE_DISBURSEMENT) n'est ni une dépense ni une recette pour l'entité prêteuse.
  const advanced = await prisma.$queryRaw<{ currency: Currency; total: string }[]>`
    SELECT x."currency" AS currency, SUM(x."amount")::text AS total
    FROM "Expense" x
    JOIN "FinancialTransaction" t ON t."expenseId" = x."id"
    WHERE x."entityId" = ${entityId}
      AND t."kind" = 'ADVANCE_DISBURSEMENT' AND t."status" = 'POSTED'
      AND x."date" >= ${from} AND x."date" <= ${to}
    GROUP BY x."currency"`;
  const byCurrency = new Map<Currency, { income: Money; expense: Money }>();
  for (const r of rows) {
    const acc = byCurrency.get(r.currency) ?? { income: ZERO, expense: ZERO };
    if (r.kind === 'INCOME') acc.income = acc.income.plus(D(r.total));
    else acc.expense = acc.expense.plus(D(r.total).abs());
    byCurrency.set(r.currency, acc);
  }
  for (const r of advanced) {
    const acc = byCurrency.get(r.currency) ?? { income: ZERO, expense: ZERO };
    acc.expense = acc.expense.plus(D(r.total));
    byCurrency.set(r.currency, acc);
  }
  return (['USD', 'CDF'] as const).map((currency) => {
    const v = byCurrency.get(currency) ?? { income: ZERO, expense: ZERO };
    return { currency, income: toMoneyString(v.income), expense: toMoneyString(v.expense) };
  });
}
