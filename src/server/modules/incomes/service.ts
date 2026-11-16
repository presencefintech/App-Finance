import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { parseFlexibleDate } from '@/lib/dates';
import type { Paginated } from '@/lib/schemas/common';
import type { CreateIncomeInput, ListOperationsInput } from '@/lib/schemas/operations';
import type { CurrentUser, RequestMeta } from '@/server/auth';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { postTransaction } from '@/server/ledger';
import { D, toMoneyString } from '@/server/money';
import { assertCan, assertEntityAccess, readableEntityIds } from '@/server/permissions';
import { assertEvidenceProvided, linkEvidence } from '../attachments/evidence';
import { assertPaymentMethodMatches, loadAccountFor, parseInputDate } from '../shared';

type Tx = Prisma.TransactionClient;

const view = (i: Prisma.IncomeGetPayload<object>) => ({
  id: i.id, reference: i.reference, entityId: i.entityId, date: i.date, source: i.source, categoryId: i.categoryId,
  amount: toMoneyString(D(i.amount)), currency: i.currency, paymentMethod: i.paymentMethod,
  accountId: i.accountId, note: i.note, createdAt: i.createdAt,
});
export type IncomeView = ReturnType<typeof view>;

/**
 * Écrit une recette (écriture INCOME + fiche Income) dans la transaction fournie.
 * Justificatif obligatoire au-delà du seuil de l'entité, sauf `skipEvidence` (import de totaux, rapprochement bancaire :
 * le relevé ou le fichier source fait foi).
 */
export async function recordIncome(
  tx: Tx, actor: CurrentUser, input: CreateIncomeInput, meta: RequestMeta, opts: { skipEvidence?: boolean } = {},
) {
  assertEntityAccess(actor, input.entityId);
  assertCan(actor, 'transaction.record', input.entityId);
  const account = await loadAccountFor(tx, actor, input.accountId, 'transaction.record');
  if (account.entityId !== input.entityId) throw new AppError('ENTITY_MISMATCH', 400, "Le compte n'appartient pas à l'entité");
  if (account.currency !== input.currency) throw new AppError('CURRENCY_MISMATCH', 400, 'La devise doit être celle du compte de réception');
  assertPaymentMethodMatches(account, input.paymentMethod);
  const category = await tx.category.findFirst({ where: { id: input.categoryId, entityId: input.entityId, kind: 'INCOME', isActive: true } });
  if (!category) throw new AppError('VALIDATION_ERROR', 400, 'Catégorie de recette inconnue');

  if (!opts.skipEvidence) await assertEvidenceProvided(tx, input);

  const date = parseInputDate(input.date);
  const incomeId = randomUUID();
  const posted = await postTransaction(tx, {
    entityId: input.entityId, kind: 'INCOME', date, description: `${input.source} — ${category.name}`,
    createdById: actor.id, lines: [{ accountId: account.id, amount: D(input.amount) }],
    links: { incomeId }, ip: meta.ip,
  });
  await linkEvidence(tx, actor, { entityId: input.entityId, txId: posted.id, attachmentIds: input.attachmentIds }, meta);
  const row = await tx.income.create({
    data: {
      id: incomeId, reference: posted.reference, entityId: input.entityId, date, source: input.source,
      categoryId: input.categoryId, amount: input.amount, currency: input.currency,
      paymentMethod: input.paymentMethod, accountId: account.id, note: input.note, createdById: actor.id,
    },
  });
  return view(row);
}

export const createIncome = (actor: CurrentUser, input: CreateIncomeInput, meta: RequestMeta) =>
  prisma.$transaction((tx) => recordIncome(tx, actor, input, meta));

export function incomeWhere(actor: CurrentUser, q: Partial<ListOperationsInput>): Prisma.IncomeWhereInput {
  const allowed = readableEntityIds(actor, 'account.read').filter((id) => !q.entityId || id === q.entityId);
  return {
    entityId: { in: allowed },
    ...(q.categoryId ? { categoryId: q.categoryId } : {}),
    ...(q.currency ? { currency: q.currency } : {}),
    ...(q.beneficiary ? { source: { contains: q.beneficiary, mode: 'insensitive' } } : {}),
    ...(q.from || q.to ? { date: { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } } : {}),
  };
}

export async function listIncomes(actor: CurrentUser, q: Partial<ListOperationsInput> & { page: number; pageSize: number }): Promise<Paginated<IncomeView>> {
  const where = incomeWhere(actor, q);
  const [total, rows] = await Promise.all([
    prisma.income.count({ where }),
    prisma.income.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { data: rows.map(view), page: q.page, pageSize: q.pageSize, total };
}

export async function getIncome(actor: CurrentUser, id: string): Promise<IncomeView> {
  const row = await prisma.income.findUnique({ where: { id } });
  if (!row || !readableEntityIds(actor, 'account.read').includes(row.entityId)) throw new AppError('NOT_FOUND', 404, 'Recette introuvable');
  return view(row);
}

/**
 * Import CSV de totaux (ex. frais scolaires exportés de PresenceFintech) : date;rubrique;montant;devise.
 * Tout ou rien : une ligne invalide annule l'import et toutes les erreurs sont renvoyées.
 */
export async function importIncomesCsv(
  actor: CurrentUser, input: { entityId: string; accountId: string; categoryId: string; csv: string }, meta: RequestMeta,
) {
  const lines = input.csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const sep = (lines[0] ?? '').includes(';') ? ';' : ',';
  const rows = lines.map((l, i) => ({ line: i + 1, cells: l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '')) }));
  if (rows[0] && /date/i.test(rows[0].cells[0] ?? '')) rows.shift(); // en-tête
  if (rows.length === 0) throw new AppError('VALIDATION_ERROR', 400, 'Fichier vide');
  if (rows.length > 500) throw new AppError('VALIDATION_ERROR', 400, '500 lignes maximum par import');

  const errors: { line: number; message: string }[] = [];
  const parsed: CreateIncomeInput[] = [];
  const account = await prisma.account.findUnique({ where: { id: input.accountId } });
  for (const { line, cells } of rows) {
    const [dateRaw = '', source = '', amountRaw = '', currencyRaw = ''] = cells;
    const date = parseFlexibleDate(dateRaw);
    const amount = amountRaw.replace(/\s/g, '').replace(',', '.');
    const currency = currencyRaw.toUpperCase();
    if (!date) errors.push({ line, message: `Date invalide « ${dateRaw} »` });
    else if (source.length < 2) errors.push({ line, message: 'Rubrique manquante' });
    else if (!/^\d{1,16}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) errors.push({ line, message: `Montant invalide « ${amountRaw} »` });
    else if (currency !== 'USD' && currency !== 'CDF') errors.push({ line, message: `Devise invalide « ${currencyRaw} »` });
    else if (account && account.currency !== currency) errors.push({ line, message: `Devise ${currency} ≠ devise du compte (${account.currency})` });
    else {
      parsed.push({
        entityId: input.entityId, accountId: input.accountId, categoryId: input.categoryId, date: date.toISOString(),
        source, amount, currency, paymentMethod: account?.type === 'CASH' ? 'CASH' : 'BANK_TRANSFER',
      });
    }
  }
  if (errors.length) throw new AppError('IMPORT_INVALID', 400, `${errors.length} ligne(s) invalide(s) : rien n'a été importé`, errors);

  return prisma.$transaction(async (tx) => {
    const created = [];
    for (const p of parsed) created.push(await recordIncome(tx, actor, p, meta, { skipEvidence: true }));
    return { imported: created.length, references: created.map((c) => c.reference) };
  });
}
