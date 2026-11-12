import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import type { TxKind } from '@/generated/prisma/enums';
import type { FxFormInput } from '@/lib/schemas/operations';
import { writeAudit } from '@/server/audit';
import type { CurrentUser, RequestMeta } from '@/server/auth';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { getAccountBalance, postTransaction } from '@/server/ledger';
import { D, toMoneyString } from '@/server/money';
import { notifyRole } from '@/server/notifications';
import { nextReference } from '@/server/references';
import { accessibleEntityIds, assertCan, readableEntityIds } from '@/server/permissions';
import { buildFx, loadAccountFor, parseInputDate } from '../shared';


interface TransferParams {
  kind: Extract<TxKind, 'CASH_TO_BANK' | 'BANK_TO_BANK' | 'CASH_TO_CASH'>;
  fromId: string; toId: string; amount: string; description?: string; date?: string; fx?: FxFormInput;
  fromType: 'CASH' | 'BANK'; toType: 'CASH' | 'BANK'; label: string;
}

/**
 * Transfert interne (règle 6) : jamais une recette ni une dépense.
 * Deux comptes de la MÊME entité ; entre entités c'est une avance (règle 7), pas un transfert.
 */
async function postTransfer(actor: CurrentUser, p: TransferParams, meta: RequestMeta) {
  return prisma.$transaction(async (tx) => {
    const from = await loadAccountFor(tx, actor, p.fromId, 'transaction.record');
    const to = await loadAccountFor(tx, actor, p.toId, 'transaction.record');
    if (from.id === to.id) throw new AppError('VALIDATION_ERROR', 400, 'Comptes source et destination identiques');
    if (from.entityId !== to.entityId) {
      throw new AppError('ENTITY_MISMATCH', 400, "Un transfert reste dans la même entité : entre entités, utilisez une avance");
    }
    if (from.type !== p.fromType || to.type !== p.toType) {
      throw new AppError('VALIDATION_ERROR', 400, `${p.label} : types de comptes incorrects`);
    }
    const amount = D(p.amount);
    let toAmount = amount;
    let fx;
    if (from.currency !== to.currency) {
      if (!p.fx) throw new AppError('FX_REQUIRED', 400, 'Conversion (taux, date, source) obligatoire entre deux devises');
      ({ fx, toAmount } = buildFx(p.fx, from, to, amount));
    } else if (p.fx) {
      throw new AppError('VALIDATION_ERROR', 400, 'Aucune conversion pour deux comptes de même devise');
    }
    const posted = await postTransaction(tx, {
      entityId: from.entityId, kind: p.kind, date: parseInputDate(p.date),
      description: p.description?.trim() || `${p.label} : ${from.name} → ${to.name}`,
      createdById: actor.id,
      lines: [{ accountId: from.id, amount: amount.negated() }, { accountId: to.id, amount: toAmount }],
      fx, ip: meta.ip,
    });
    return { id: posted.id, reference: posted.reference };
  });
}

export const depositToBank = (actor: CurrentUser, i: { cashAccountId: string; bankAccountId: string; amount: string; description?: string; date?: string; fx?: FxFormInput }, meta: RequestMeta) =>
  postTransfer(actor, { kind: 'CASH_TO_BANK', fromId: i.cashAccountId, toId: i.bankAccountId, amount: i.amount, description: i.description, date: i.date, fx: i.fx, fromType: 'CASH', toType: 'BANK', label: 'Versement en banque' }, meta);

export const transferBankToBank = (actor: CurrentUser, i: { fromAccountId: string; toAccountId: string; amount: string; description?: string; date?: string; fx?: FxFormInput }, meta: RequestMeta) =>
  postTransfer(actor, { kind: 'BANK_TO_BANK', fromId: i.fromAccountId, toId: i.toAccountId, amount: i.amount, description: i.description, date: i.date, fx: i.fx, fromType: 'BANK', toType: 'BANK', label: 'Virement' }, meta);

export const transferCashToCash = (actor: CurrentUser, i: { fromAccountId: string; toAccountId: string; amount: string; description?: string; date?: string; fx?: FxFormInput }, meta: RequestMeta) =>
  postTransfer(actor, { kind: 'CASH_TO_CASH', fromId: i.fromAccountId, toId: i.toAccountId, amount: i.amount, description: i.description, date: i.date, fx: i.fx, fromType: 'CASH', toType: 'CASH', label: 'Transfert de caisse' }, meta);

/** Frais bancaires : dépense (BANK_FEE) rangée dans la catégorie « Frais bancaires ». À appeler dans une transaction. */
export async function recordBankFeeTx(
  tx: Prisma.TransactionClient, actor: CurrentUser,
  i: { bankAccountId: string; amount: string; description: string; date?: string }, meta: RequestMeta,
) {
  const bank = await loadAccountFor(tx, actor, i.bankAccountId, 'transaction.record');
  if (bank.type !== 'BANK') throw new AppError('VALIDATION_ERROR', 400, 'Les frais bancaires se saisissent sur un compte bancaire');
  const date = parseInputDate(i.date);
  const category = await tx.category.upsert({
    where: { entityId_kind_name: { entityId: bank.entityId, kind: 'EXPENSE', name: 'Frais bancaires' } },
    update: {}, create: { entityId: bank.entityId, kind: 'EXPENSE', name: 'Frais bancaires' },
  });
  const expenseId = randomUUID();
  const posted = await postTransaction(tx, {
    entityId: bank.entityId, kind: 'BANK_FEE', date, description: i.description, createdById: actor.id,
    lines: [{ accountId: bank.id, amount: D(i.amount).negated() }], links: { expenseId }, ip: meta.ip,
  });
  await tx.expense.create({
    data: {
      id: expenseId, reference: posted.reference, entityId: bank.entityId, date, categoryId: category.id,
      beneficiary: bank.bankName ?? bank.name, purpose: i.description, amount: i.amount, currency: bank.currency,
      paymentMethod: 'BANK_TRANSFER', accountId: bank.id, createdById: actor.id,
    },
  });
  return { id: posted.id, reference: posted.reference };
}

export const recordBankFee = (
  actor: CurrentUser, i: { bankAccountId: string; amount: string; description: string; date?: string }, meta: RequestMeta,
) => prisma.$transaction((tx) => recordBankFeeTx(tx, actor, i, meta));

// --- Retrait bancaire en deux temps ----------------------------------------------------------

const pendingView = (p: Prisma.PendingTransferGetPayload<object>) => ({
  id: p.id, reference: p.reference, entityId: p.entityId, bankAccountId: p.bankAccountId, cashAccountId: p.cashAccountId,
  amount: toMoneyString(D(p.amount)), currency: p.currency, description: p.description, status: p.status,
  initiatedAt: p.initiatedAt, confirmedAt: p.confirmedAt, cancelledReason: p.cancelledReason,
});

/** Temps 1 : le retrait est « en transit », AUCUNE écriture (l'argent n'est pas encore en caisse). */
export async function initiateWithdrawal(
  actor: CurrentUser, i: { bankAccountId: string; cashAccountId: string; amount: string; description?: string }, meta: RequestMeta,
) {
  return prisma.$transaction(async (tx) => {
    const bank = await loadAccountFor(tx, actor, i.bankAccountId, 'transaction.record');
    const cash = await loadAccountFor(tx, actor, i.cashAccountId, 'transaction.record');
    if (bank.type !== 'BANK' || cash.type !== 'CASH') throw new AppError('VALIDATION_ERROR', 400, 'Un retrait va d’un compte bancaire vers une caisse');
    if (bank.entityId !== cash.entityId) throw new AppError('ENTITY_MISMATCH', 400, 'Banque et caisse doivent appartenir à la même entité');
    if (bank.currency !== cash.currency) throw new AppError('CURRENCY_MISMATCH', 400, 'Retrait possible seulement entre comptes de même devise');
    const amount = D(i.amount);
    if (!bank.allowOverdraft && (await getAccountBalance(tx, bank.id)).lessThan(amount)) {
      throw new AppError('INSUFFICIENT_FUNDS', 409, 'Solde bancaire insuffisant');
    }
    const reference = await nextReference(tx, bank.entityId, 'RETP');
    const row = await tx.pendingTransfer.create({
      data: {
        reference, entityId: bank.entityId, bankAccountId: bank.id, cashAccountId: cash.id, amount: i.amount,
        currency: bank.currency, description: i.description?.trim() || `Retrait ${bank.name} → ${cash.name}`, initiatedById: actor.id,
      },
    });
    await writeAudit(tx, {
      actorId: actor.id, action: 'withdrawal.initiate', entityType: 'PendingTransfer', entityId: row.id,
      after: { reference, amount: i.amount, currency: bank.currency }, ip: meta.ip,
    });
    await notifyRole(tx, bank.entityId, ['CASHIER'], {
      title: 'Retrait en transit', body: `${reference} — ${i.amount} ${bank.currency} : confirmez la réception en caisse`,
    }, actor.id);
    return pendingView(row);
  });
}

/** Temps 2 : le caissier confirme la réception ; seules ces écritures (BANK_TO_CASH) bougent les soldes. */
export async function confirmWithdrawal(actor: CurrentUser, id: string, meta: RequestMeta) {
  const pre = await prisma.pendingTransfer.findUnique({ where: { id } });
  if (!pre || !accessibleEntityIds(actor).includes(pre.entityId)) throw new AppError('NOT_FOUND', 404, 'Retrait introuvable');
  if (!actor.roles.some((r) => r.entityId === pre.entityId && r.role === 'CASHIER')) {
    throw new AppError('FORBIDDEN', 403, 'Seul le caissier confirme la réception des fonds');
  }
  assertCan(actor, 'transaction.record', pre.entityId);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PendingTransfer" WHERE "id" = ${id} FOR UPDATE`;
    const p = await tx.pendingTransfer.findUniqueOrThrow({ where: { id } });
    if (p.status !== 'IN_TRANSIT') throw new AppError('INVALID_STATE', 409, `Ce retrait est déjà « ${p.status} »`);
    const posted = await postTransaction(tx, {
      entityId: p.entityId, kind: 'BANK_TO_CASH', date: new Date(), description: `${p.description} (${p.reference})`,
      createdById: actor.id,
      lines: [{ accountId: p.bankAccountId, amount: D(p.amount).negated() }, { accountId: p.cashAccountId, amount: D(p.amount) }],
      ip: meta.ip,
    });
    const row = await tx.pendingTransfer.update({
      where: { id }, data: { status: 'CONFIRMED', confirmedById: actor.id, confirmedAt: new Date(), txId: posted.id },
    });
    await writeAudit(tx, {
      actorId: actor.id, action: 'withdrawal.confirm', entityType: 'PendingTransfer', entityId: id,
      before: { status: 'IN_TRANSIT' }, after: { status: 'CONFIRMED', txId: posted.id }, ip: meta.ip,
    });
    return pendingView(row);
  });
}

export async function cancelWithdrawal(actor: CurrentUser, id: string, reason: string, meta: RequestMeta) {
  if (reason.trim().length < 3) throw new AppError('REASON_REQUIRED', 400, 'Motif obligatoire');
  const pre = await prisma.pendingTransfer.findUnique({ where: { id } });
  if (!pre || !accessibleEntityIds(actor).includes(pre.entityId)) throw new AppError('NOT_FOUND', 404, 'Retrait introuvable');
  const isController = actor.roles.some((r) => r.entityId === pre.entityId && r.role === 'CONTROLLER');
  if (pre.initiatedById !== actor.id && !isController) throw new AppError('FORBIDDEN', 403, 'Annulation réservée à l’initiateur ou à la contrôleuse');

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PendingTransfer" WHERE "id" = ${id} FOR UPDATE`;
    const p = await tx.pendingTransfer.findUniqueOrThrow({ where: { id } });
    if (p.status !== 'IN_TRANSIT') throw new AppError('INVALID_STATE', 409, `Ce retrait est déjà « ${p.status} »`);
    const row = await tx.pendingTransfer.update({ where: { id }, data: { status: 'CANCELLED', cancelledReason: reason.trim() } });
    await writeAudit(tx, {
      actorId: actor.id, action: 'withdrawal.cancel', entityType: 'PendingTransfer', entityId: id,
      before: { status: 'IN_TRANSIT' }, after: { status: 'CANCELLED', reason: reason.trim() }, ip: meta.ip,
    });
    return pendingView(row);
  });
}

export async function listWithdrawals(actor: CurrentUser, status?: 'IN_TRANSIT' | 'CONFIRMED' | 'CANCELLED') {
  const rows = await prisma.pendingTransfer.findMany({
    where: { entityId: { in: readableEntityIds(actor, 'account.read') }, ...(status ? { status } : {}) },
    orderBy: { initiatedAt: 'desc' }, take: 100,
  });
  return rows.map(pendingView);
}

