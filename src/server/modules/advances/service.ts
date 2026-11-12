import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Account, Prisma } from '@/generated/prisma/client';
import type { Currency } from '@/generated/prisma/enums';
import type { CreateAdvanceInput, RepaymentInput } from '@/lib/schemas/advances';
import { writeAudit } from '@/server/audit';
import type { CurrentUser, RequestMeta } from '@/server/auth';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { postTransaction, type FxInput } from '@/server/ledger';
import { D, ZERO, round2, sum, toMoneyString, type Money } from '@/server/money';
import { notifyRole } from '@/server/notifications';
import { assertCan, readableEntityIds } from '@/server/permissions';
import { nextReference } from '@/server/references';
import { getSetting } from '@/server/settings';
import { loadAccountFor, parseInputDate } from '../shared';

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const DEFAULT_ALERT_DAYS = 30;

/** Remboursé et reste dû, en devise de l'avance — uniquement les remboursements non contre-passés. */
async function repaidAmount(db: Db, advanceId: string): Promise<Money> {
  const reps = await db.advanceRepayment.findMany({ where: { advanceId }, select: { amount: true, txId: true } });
  if (reps.length === 0) return ZERO;
  const live = await db.financialTransaction.findMany({
    where: { id: { in: reps.map((r) => r.txId) }, status: 'POSTED' },
    select: { id: true },
  });
  const liveIds = new Set(live.map((t) => t.id));
  return sum(reps.filter((r) => liveIds.has(r.txId)).map((r) => D(r.amount)));
}

/** Recalcule le statut d'après les remboursements actifs (après remboursement ou contre-passation). */
export async function recomputeAdvanceStatus(tx: Tx, advanceId: string) {
  const adv = await tx.interEntityAdvance.findUniqueOrThrow({ where: { id: advanceId } });
  if (adv.status === 'CANCELLED') return adv;
  const repaid = await repaidAmount(tx, advanceId);
  const status = repaid.isZero() ? 'OPEN' : repaid.greaterThanOrEqualTo(D(adv.amount)) ? 'REPAID' : 'PARTIALLY_REPAID';
  return tx.interEntityAdvance.update({ where: { id: advanceId }, data: { status } });
}

/** Une avance ne peut être annulée (contre-passation du décaissement) que sans remboursement actif. */
export async function cancelAdvanceOnReversal(tx: Tx, advanceId: string) {
  if (!(await repaidAmount(tx, advanceId)).isZero()) {
    throw new AppError('ADVANCE_HAS_REPAYMENTS', 409, 'Des remboursements existent : contre-passez-les d’abord');
  }
  await tx.interEntityAdvance.update({ where: { id: advanceId }, data: { status: 'CANCELLED' } });
}

/**
 * Cœur du flux d'avance : l'entité prêteuse paie (ADVANCE_DISBURSEMENT, −X sur SON compte), la dépense est
 * rattachée à l'entité EMPRUNTEUSE, et une créance/dette est créée. Ni recette ni dépense pour le prêteur.
 */
export async function openAdvanceForExpense(
  tx: Tx, actor: CurrentUser,
  p: {
    lender: Account; borrowerEntityId: string; amount: Money; description: string; date: Date;
    beneficiary: string; purpose: string; categoryId?: string; departmentId?: string | null; fundRequestId?: string;
  },
  meta: RequestMeta,
) {
  if (p.lender.entityId === p.borrowerEntityId) throw new AppError('VALIDATION_ERROR', 400, 'Prêteur et emprunteur doivent être deux entités différentes');
  const borrower = await tx.entity.findUnique({ where: { id: p.borrowerEntityId } });
  if (!borrower) throw new AppError('NOT_FOUND', 404, 'Entité emprunteuse introuvable');
  const lenderEntity = await tx.entity.findUniqueOrThrow({ where: { id: p.lender.entityId } });

  let categoryId = p.categoryId;
  if (categoryId) {
    const cat = await tx.category.findFirst({ where: { id: categoryId, entityId: p.borrowerEntityId, kind: 'EXPENSE' } });
    if (!cat) throw new AppError('VALIDATION_ERROR', 400, "Catégorie de dépense inconnue pour l'entité emprunteuse");
  } else {
    categoryId = (await tx.category.upsert({
      where: { entityId_kind_name: { entityId: p.borrowerEntityId, kind: 'EXPENSE', name: 'Dépenses payées par avance' } },
      update: {}, create: { entityId: p.borrowerEntityId, kind: 'EXPENSE', name: 'Dépenses payées par avance' },
    })).id;
  }

  const advanceId = randomUUID();
  const expenseId = randomUUID();
  const reference = await nextReference(tx, p.lender.entityId, 'AV', p.date);
  const posted = await postTransaction(tx, {
    entityId: p.lender.entityId, kind: 'ADVANCE_DISBURSEMENT', date: p.date,
    description: `Avance ${lenderEntity.name} → ${borrower.name} — ${p.description}`.slice(0, 300),
    createdById: actor.id, lines: [{ accountId: p.lender.id, amount: p.amount.negated() }],
    links: { fundRequestId: p.fundRequestId, expenseId, advanceId }, ip: meta.ip,
  });
  const advance = await tx.interEntityAdvance.create({
    data: {
      id: advanceId, reference, lenderEntityId: p.lender.entityId, borrowerEntityId: p.borrowerEntityId,
      amount: p.amount, currency: p.lender.currency, date: p.date, fundRequestId: p.fundRequestId,
      description: p.description, createdById: actor.id,
    },
  });
  await tx.expense.create({
    data: {
      id: expenseId, reference: posted.reference, entityId: p.borrowerEntityId, date: p.date, categoryId,
      departmentId: p.departmentId ?? undefined, beneficiary: p.beneficiary, purpose: p.purpose,
      amount: p.amount, currency: p.lender.currency,
      paymentMethod: p.lender.type === 'CASH' ? 'CASH' : 'BANK_TRANSFER',
      accountId: p.lender.id, fundRequestId: p.fundRequestId, createdById: actor.id,
    },
  });
  await writeAudit(tx, {
    actorId: actor.id, action: 'advance.create', entityType: 'InterEntityAdvance', entityId: advance.id,
    after: { reference, lender: lenderEntity.code, borrower: borrower.code, amount: toMoneyString(p.amount), currency: p.lender.currency }, ip: meta.ip,
  });
  for (const entityId of [p.lender.entityId, p.borrowerEntityId]) {
    await notifyRole(tx, entityId, ['CONTROLLER'], {
      title: 'Avance inter-entités', body: `${reference} : ${lenderEntity.name} avance ${toMoneyString(p.amount)} ${p.lender.currency} à ${borrower.name}`,
      href: `/avances/${advance.id}`,
    }, actor.id);
  }
  return { advance, txId: posted.id };
}

/** Avance manuelle : l'entité prêteuse a payé une dépense de l'autre entité. Contrôleuse uniquement. */
export async function createManualAdvance(actor: CurrentUser, input: CreateAdvanceInput, meta: RequestMeta) {
  return prisma.$transaction(async (tx) => {
    const lender = await loadAccountFor(tx, actor, input.lenderAccountId, 'advance.manage');
    const { advance } = await openAdvanceForExpense(tx, actor, {
      lender, borrowerEntityId: input.borrowerEntityId, amount: D(input.amount), date: parseInputDate(input.date),
      description: input.purpose, beneficiary: input.beneficiary, purpose: input.purpose, categoryId: input.categoryId,
    }, meta);
    return getAdvanceView(tx, advance.id);
  });
}

async function getAdvanceView(db: Db, id: string) {
  const adv = await db.interEntityAdvance.findUniqueOrThrow({ where: { id } });
  const [entities, repaid, reps, alertSetting] = await Promise.all([
    db.entity.findMany({ where: { id: { in: [adv.lenderEntityId, adv.borrowerEntityId] } }, select: { id: true, name: true, code: true } }),
    repaidAmount(db, id),
    db.advanceRepayment.findMany({ where: { advanceId: id }, orderBy: { date: 'asc' } }),
    getSetting(db, 'advanceAlertDays'),
  ]);
  const txs = await db.financialTransaction.findMany({
    where: { id: { in: reps.map((r) => r.txId) } }, select: { id: true, status: true, reference: true },
  });
  const txById = new Map(txs.map((t) => [t.id, t]));
  const name = (eid: string) => entities.find((e) => e.id === eid)?.name ?? eid;
  const remaining = adv.status === 'CANCELLED' ? ZERO : D(adv.amount).minus(repaid);
  const ageDays = Math.floor((Date.now() - adv.date.getTime()) / 86_400_000);
  const alertDays = Number(alertSetting) > 0 ? Number(alertSetting) : DEFAULT_ALERT_DAYS;
  return {
    id: adv.id, reference: adv.reference, lenderEntityId: adv.lenderEntityId, borrowerEntityId: adv.borrowerEntityId,
    lenderName: name(adv.lenderEntityId), borrowerName: name(adv.borrowerEntityId),
    amount: toMoneyString(D(adv.amount)), currency: adv.currency as Currency, date: adv.date, description: adv.description,
    status: adv.status, fundRequestId: adv.fundRequestId,
    repaid: toMoneyString(repaid), remaining: toMoneyString(remaining), ageDays,
    overdue: (adv.status === 'OPEN' || adv.status === 'PARTIALLY_REPAID') && ageDays > alertDays,
    repayments: reps.map((r) => ({
      id: r.id, amount: toMoneyString(D(r.amount)), currency: r.currency, date: r.date,
      reference: txById.get(r.txId)?.reference ?? '', reversed: txById.get(r.txId)?.status === 'REVERSED',
    })),
  };
}
export type AdvanceView = Awaited<ReturnType<typeof getAdvanceView>>;

/** Visible depuis les DEUX entités (prêteuse et emprunteuse). */
async function assertAdvanceAccess(actor: CurrentUser, id: string) {
  const adv = await prisma.interEntityAdvance.findUnique({ where: { id } });
  const mine = readableEntityIds(actor, 'account.read');
  if (!adv || (!mine.includes(adv.lenderEntityId) && !mine.includes(adv.borrowerEntityId))) {
    throw new AppError('NOT_FOUND', 404, 'Avance introuvable');
  }
  return adv;
}

export async function getAdvance(actor: CurrentUser, id: string) {
  await assertAdvanceAccess(actor, id);
  return getAdvanceView(prisma, id);
}

export async function listAdvances(actor: CurrentUser, q: { status?: string; entityId?: string } = {}) {
  const mine = readableEntityIds(actor, 'account.read').filter((e) => !q.entityId || e === q.entityId);
  const rows = await prisma.interEntityAdvance.findMany({
    where: {
      OR: [{ lenderEntityId: { in: mine } }, { borrowerEntityId: { in: mine } }],
      ...(q.status ? { status: q.status as 'OPEN' | 'PARTIALLY_REPAID' | 'REPAID' | 'CANCELLED' } : {}),
    },
    orderBy: { date: 'desc' }, take: 200,
  });
  return Promise.all(rows.map((r) => getAdvanceView(prisma, r.id)));
}

/**
 * Remboursement (partiel possible) d'une avance : ADVANCE_REPAYMENT du compte emprunteur vers le compte prêteur.
 * Le restant dû est calculé dans la devise de l'avance ; un paiement dans l'autre devise exige une conversion enregistrée.
 * Nécessite les droits sur les DEUX entités (la contrôleuse supervise les deux).
 */
export async function repayAdvance(actor: CurrentUser, advanceId: string, input: RepaymentInput, meta: RequestMeta) {
  await assertAdvanceAccess(actor, advanceId);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "InterEntityAdvance" WHERE "id" = ${advanceId} FOR UPDATE`;
    const adv = await tx.interEntityAdvance.findUniqueOrThrow({ where: { id: advanceId } });
    if (adv.status === 'CANCELLED' || adv.status === 'REPAID') {
      throw new AppError('INVALID_STATE', 409, `Avance déjà « ${adv.status} »`);
    }
    const from = await loadAccountFor(tx, actor, input.fromAccountId, 'advance.manage');
    const to = await loadAccountFor(tx, actor, input.toAccountId, 'advance.manage');
    if (from.entityId !== adv.borrowerEntityId || to.entityId !== adv.lenderEntityId) {
      throw new AppError('ENTITY_MISMATCH', 400, 'Le remboursement va d’un compte de l’emprunteur vers un compte du prêteur');
    }
    const amount = D(input.amount);
    const remaining = D(adv.amount).minus(await repaidAmount(tx, advanceId));
    if (amount.greaterThan(remaining)) {
      throw new AppError('ADVANCE_OVERPAYMENT', 409, 'Montant supérieur au restant dû', { remaining: toMoneyString(remaining), currency: adv.currency });
    }

    const cur = adv.currency;
    let fromAmount = amount;
    let toAmount = amount;
    let fx: FxInput | undefined;
    if (from.currency === cur && to.currency === cur) {
      if (input.fx) throw new AppError('VALIDATION_ERROR', 400, 'Aucune conversion : les deux comptes sont dans la devise de l’avance');
    } else if (from.currency !== cur && to.currency !== cur) {
      throw new AppError('CURRENCY_MISMATCH', 400, 'Au moins un des deux comptes doit être dans la devise de l’avance');
    } else {
      if (!input.fx) throw new AppError('FX_REQUIRED', 400, 'Conversion (taux, date, source) obligatoire entre deux devises');
      const rate = D(input.fx.rate);
      if (from.currency === cur) {
        toAmount = input.fx.toAmount ? D(input.fx.toAmount) : round2(amount.times(rate));
      } else {
        if (!input.fromAmount) throw new AppError('VALIDATION_ERROR', 400, 'Montant débité (fromAmount) requis quand le compte payeur est dans l’autre devise');
        fromAmount = D(input.fromAmount);
        toAmount = amount;
      }
      fx = {
        fromAmount, fromCurrency: from.currency, toAmount, toCurrency: to.currency, rate,
        rateDate: new Date(input.fx.rateDate), rateSource: input.fx.rateSource,
      };
    }

    const date = parseInputDate(input.date);
    const posted = await postTransaction(tx, {
      entityId: adv.borrowerEntityId, kind: 'ADVANCE_REPAYMENT', date,
      description: `Remboursement de l'avance ${adv.reference}`, createdById: actor.id,
      lines: [{ accountId: from.id, amount: fromAmount.negated() }, { accountId: to.id, amount: toAmount }],
      fx, links: { advanceId }, ip: meta.ip,
    });
    await tx.advanceRepayment.create({ data: { advanceId, txId: posted.id, amount, currency: cur, date } });
    const updated = await recomputeAdvanceStatus(tx, advanceId);
    await writeAudit(tx, {
      actorId: actor.id, action: 'advance.repay', entityType: 'InterEntityAdvance', entityId: advanceId,
      before: { status: adv.status }, after: { status: updated.status, amount: toMoneyString(amount), currency: cur }, ip: meta.ip,
    });
    await notifyRole(tx, adv.lenderEntityId, ['CONTROLLER'], {
      title: 'Remboursement reçu', body: `${adv.reference} : ${toMoneyString(amount)} ${cur}`, href: `/avances/${advanceId}`,
    }, actor.id);
    return getAdvanceView(tx, advanceId);
  });
}

/** Totaux des avances ouvertes par sens (créances / dettes) et par devise pour une entité — tableau de bord. */
export async function openAdvanceTotals(actor: CurrentUser, entityId: string) {
  assertCan(actor, 'account.read', entityId);
  const advs = await listAdvances(actor, { entityId });
  const open = advs.filter((a) => a.status === 'OPEN' || a.status === 'PARTIALLY_REPAID');
  const tally = (pick: (a: AdvanceView) => boolean) =>
    (['USD', 'CDF'] as const).map((currency) => ({
      currency,
      total: toMoneyString(sum(open.filter((a) => pick(a) && a.currency === currency).map((a) => D(a.remaining)))),
    }));
  return {
    receivable: tally((a) => a.lenderEntityId === entityId), // créances : on a avancé
    payable: tally((a) => a.borrowerEntityId === entityId), // dettes : on nous a avancé
    overdueCount: open.filter((a) => a.overdue).length,
  };
}
