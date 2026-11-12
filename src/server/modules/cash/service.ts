import 'server-only';
import { localDay, localDayEnd } from '@/lib/dates';
import type { CashClosingInput } from '@/lib/schemas/operations';
import { writeAudit } from '@/server/audit';
import type { CurrentUser, RequestMeta } from '@/server/auth';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { getAccountBalance, postTransaction } from '@/server/ledger';
import { D, ZERO, toMoneyString } from '@/server/money';
import { notifyRole } from '@/server/notifications';
import { accessibleEntityIds, assertCan } from '@/server/permissions';
import { loadAccountFor } from '../shared';

const view = (s: {
  id: string; accountId: string; date: Date; theoreticalBalance: unknown; countedBalance: unknown; difference: unknown;
  justification: string | null; status: string; closedAt: Date; validatedAt: Date | null;
}) => ({
  id: s.id, accountId: s.accountId, date: s.date,
  theoreticalBalance: toMoneyString(D(String(s.theoreticalBalance))),
  countedBalance: toMoneyString(D(String(s.countedBalance))),
  difference: toMoneyString(D(String(s.difference))),
  justification: s.justification, status: s.status, closedAt: s.closedAt, validatedAt: s.validatedAt,
});

/** Somme des coupures (valeur faciale × nombre) — doit égaler le comptage saisi. */
function denominationsTotal(d: Record<string, number>) {
  return Object.entries(d).reduce((acc, [face, count]) => acc.plus(D(face).times(count)), ZERO);
}

/**
 * Clôture journalière : solde théorique (dérivé du grand livre à la fin du jour), comptage physique, écart.
 * Écart ≠ 0 ⇒ justification obligatoire ; l'écriture d'ajustement n'est créée qu'après validation d'une contrôleuse.
 */
export async function closeCashDay(actor: CurrentUser, accountId: string, input: CashClosingInput, meta: RequestMeta) {
  return prisma.$transaction(async (tx) => {
    const account = await loadAccountFor(tx, actor, accountId, 'cash.close');
    if (account.type !== 'CASH') throw new AppError('VALIDATION_ERROR', 400, 'Seule une caisse se clôture');

    const now = new Date();
    const day = localDay(input.date ? new Date(input.date.length === 10 ? `${input.date}T12:00:00+02:00` : input.date) : now);
    if (day.getTime() > localDay(now).getTime()) throw new AppError('VALIDATION_ERROR', 400, 'Impossible de clôturer un jour futur');
    if (await tx.cashSession.findUnique({ where: { accountId_date: { accountId, date: day } } })) {
      throw new AppError('ALREADY_CLOSED', 409, 'Cette journée est déjà clôturée pour cette caisse');
    }
    // Verrou du compte : plus aucune écriture concurrente pendant le calcul du solde théorique.
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${accountId} FOR UPDATE`;

    const counted = D(input.countedBalance);
    if (input.denominations && !denominationsTotal(input.denominations).equals(counted)) {
      throw new AppError('DENOMINATIONS_MISMATCH', 400, 'Le total des coupures ne correspond pas au montant compté');
    }
    const theoretical = await getAccountBalance(tx, accountId, localDayEnd(day));
    const difference = counted.minus(theoretical);
    if (!difference.isZero() && (input.justification ?? '').trim().length < 5) {
      throw new AppError('JUSTIFICATION_REQUIRED', 400, 'Justification obligatoire en cas d’écart', {
        theoretical: toMoneyString(theoretical), counted: toMoneyString(counted), difference: toMoneyString(difference),
      });
    }

    const status = difference.isZero() ? 'CLOSED' : 'PENDING_VALIDATION';
    const row = await tx.cashSession.create({
      data: {
        accountId, date: day, theoreticalBalance: theoretical, countedBalance: counted, difference,
        justification: input.justification?.trim() || null, denominations: input.denominations ?? undefined,
        status, closedById: actor.id,
      },
    });
    await writeAudit(tx, {
      actorId: actor.id, action: 'cash.close', entityType: 'CashSession', entityId: row.id,
      after: { accountId, day: day.toISOString().slice(0, 10), theoretical: toMoneyString(theoretical), counted: toMoneyString(counted), difference: toMoneyString(difference) },
      ip: meta.ip,
    });
    if (!difference.isZero()) {
      await notifyRole(tx, account.entityId, ['CONTROLLER'], {
        title: 'Écart de caisse à valider',
        body: `${account.name} : écart de ${toMoneyString(difference)} ${account.currency} — ${input.justification?.trim()}`,
      }, actor.id);
    }
    return view(row);
  });
}

/** Validation de l'écart par une contrôleuse : crée l'écriture CASH_ADJUSTMENT (±écart). */
export async function validateCashSession(actor: CurrentUser, sessionId: string, meta: RequestMeta) {
  const pre = await prisma.cashSession.findUnique({ where: { id: sessionId } });
  if (!pre) throw new AppError('NOT_FOUND', 404, 'Clôture introuvable');
  const account = await prisma.account.findUnique({ where: { id: pre.accountId } });
  if (!account || !accessibleEntityIds(actor).includes(account.entityId)) throw new AppError('NOT_FOUND', 404, 'Clôture introuvable');
  assertCan(actor, 'cash.validate', account.entityId);
  if (pre.closedById === actor.id) throw new AppError('SEPARATION_OF_DUTIES', 403, 'L’écart doit être validé par une autre personne que celle qui a clôturé');

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "CashSession" WHERE "id" = ${sessionId} FOR UPDATE`;
    const s = await tx.cashSession.findUniqueOrThrow({ where: { id: sessionId } });
    if (s.status !== 'PENDING_VALIDATION') throw new AppError('INVALID_STATE', 409, 'Cette clôture n’est pas en attente de validation');
    const diff = D(s.difference);
    const posted = await postTransaction(tx, {
      entityId: account.entityId, kind: 'CASH_ADJUSTMENT', date: new Date(),
      description: `Écart de caisse du ${s.date.toISOString().slice(0, 10)} — ${s.justification ?? ''}`.slice(0, 300),
      createdById: actor.id, lines: [{ accountId: account.id, amount: diff }], ip: meta.ip,
    });
    const row = await tx.cashSession.update({
      where: { id: sessionId },
      data: { status: 'CLOSED', validatedById: actor.id, validatedAt: new Date(), adjustmentTxId: posted.id },
    });
    await writeAudit(tx, {
      actorId: actor.id, action: 'cash.validate', entityType: 'CashSession', entityId: sessionId,
      before: { status: 'PENDING_VALIDATION' }, after: { status: 'CLOSED', adjustmentTxId: posted.id, difference: toMoneyString(diff) }, ip: meta.ip,
    });
    return view(row);
  });
}

export async function listCashSessions(actor: CurrentUser, accountId: string) {
  await loadAccountFor(prisma, actor, accountId, 'account.read');
  const rows = await prisma.cashSession.findMany({ where: { accountId }, orderBy: { date: 'desc' }, take: 90 });
  return rows.map(view);
}

/** Clôtures en attente de validation pour les entités de l'utilisateur. */
export async function listPendingCashSessions(actor: CurrentUser) {
  const accounts = await prisma.account.findMany({
    where: { entityId: { in: accessibleEntityIds(actor) }, type: 'CASH' }, select: { id: true },
  });
  const rows = await prisma.cashSession.findMany({
    where: { accountId: { in: accounts.map((a) => a.id) }, status: 'PENDING_VALIDATION' }, orderBy: { date: 'asc' },
  });
  return rows.map(view);
}
