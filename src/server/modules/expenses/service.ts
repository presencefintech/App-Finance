import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import type { Paginated } from '@/lib/schemas/common';
import type { CreateExpenseInput, ListOperationsInput } from '@/lib/schemas/operations';
import type { CurrentUser, RequestMeta } from '@/server/auth';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { postTransaction } from '@/server/ledger';
import { D, toMoneyString } from '@/server/money';
import { assertCan, assertEntityAccess, readableEntityIds } from '@/server/permissions';
import { assertEvidenceProvided, linkEvidence } from '../attachments/evidence';
import { assertPaymentMethodMatches, loadAccountFor, parseInputDate } from '../shared';

type Tx = Prisma.TransactionClient;

const view = (e: Prisma.ExpenseGetPayload<object>) => ({
  id: e.id, reference: e.reference, entityId: e.entityId, date: e.date, categoryId: e.categoryId,
  departmentId: e.departmentId, beneficiary: e.beneficiary, purpose: e.purpose,
  amount: toMoneyString(D(e.amount)), currency: e.currency, paymentMethod: e.paymentMethod,
  accountId: e.accountId, fundRequestId: e.fundRequestId, createdAt: e.createdAt,
});
export type ExpenseView = ReturnType<typeof view>;

/** Dépense directe (hors demande de fonds). Les décaissements de demandes passent par le service des demandes. */
export async function recordExpense(
  tx: Tx, actor: CurrentUser, input: CreateExpenseInput, meta: RequestMeta, opts: { skipEvidence?: boolean } = {},
) {
  assertEntityAccess(actor, input.entityId);
  assertCan(actor, 'transaction.record', input.entityId);
  const account = await loadAccountFor(tx, actor, input.accountId, 'transaction.record');
  if (account.entityId !== input.entityId) throw new AppError('ENTITY_MISMATCH', 400, "Le compte n'appartient pas à l'entité");
  if (account.currency !== input.currency) throw new AppError('CURRENCY_MISMATCH', 400, 'La devise doit être celle du compte payeur');
  assertPaymentMethodMatches(account, input.paymentMethod);
  const category = await tx.category.findFirst({ where: { id: input.categoryId, entityId: input.entityId, kind: 'EXPENSE', isActive: true } });
  if (!category) throw new AppError('VALIDATION_ERROR', 400, 'Catégorie de dépense inconnue');
  if (input.departmentId) {
    const dep = await tx.department.findFirst({ where: { id: input.departmentId, entityId: input.entityId } });
    if (!dep) throw new AppError('VALIDATION_ERROR', 400, 'Département inconnu');
  }

  if (!opts.skipEvidence) await assertEvidenceProvided(tx, input);

  const date = parseInputDate(input.date);
  const expenseId = randomUUID();
  const posted = await postTransaction(tx, {
    entityId: input.entityId, kind: 'EXPENSE', date, description: `${input.beneficiary} — ${input.purpose}`.slice(0, 300),
    createdById: actor.id, lines: [{ accountId: account.id, amount: D(input.amount).negated() }],
    links: { expenseId }, ip: meta.ip,
  });
  await linkEvidence(tx, actor, { entityId: input.entityId, txId: posted.id, attachmentIds: input.attachmentIds }, meta);
  const row = await tx.expense.create({
    data: {
      id: expenseId, reference: posted.reference, entityId: input.entityId, date, categoryId: input.categoryId,
      departmentId: input.departmentId, beneficiary: input.beneficiary, purpose: input.purpose,
      amount: input.amount, currency: input.currency, paymentMethod: input.paymentMethod,
      accountId: account.id, createdById: actor.id,
    },
  });
  return view(row);
}

export const createExpense = (actor: CurrentUser, input: CreateExpenseInput, meta: RequestMeta) =>
  prisma.$transaction((tx) => recordExpense(tx, actor, input, meta));

export function expenseWhere(actor: CurrentUser, q: Partial<ListOperationsInput>): Prisma.ExpenseWhereInput {
  const allowed = readableEntityIds(actor, 'account.read').filter((id) => !q.entityId || id === q.entityId);
  return {
    entityId: { in: allowed },
    ...(q.categoryId ? { categoryId: q.categoryId } : {}),
    ...(q.departmentId ? { departmentId: q.departmentId } : {}),
    ...(q.currency ? { currency: q.currency } : {}),
    ...(q.beneficiary ? { beneficiary: { contains: q.beneficiary, mode: 'insensitive' } } : {}),
    ...(q.from || q.to ? { date: { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } } : {}),
  };
}

export async function listExpenses(actor: CurrentUser, q: Partial<ListOperationsInput> & { page: number; pageSize: number }): Promise<Paginated<ExpenseView>> {
  const where = expenseWhere(actor, q);
  const [total, rows] = await Promise.all([
    prisma.expense.count({ where }),
    prisma.expense.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { data: rows.map(view), page: q.page, pageSize: q.pageSize, total };
}

export async function getExpense(actor: CurrentUser, id: string): Promise<ExpenseView> {
  const row = await prisma.expense.findUnique({ where: { id } });
  if (!row || !readableEntityIds(actor, 'account.read').includes(row.entityId)) throw new AppError('NOT_FOUND', 404, 'Dépense introuvable');
  return view(row);
}
