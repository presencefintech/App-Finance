import 'server-only';
import { writeAudit } from '@/server/audit';
import type { CurrentUser, RequestMeta } from '@/server/auth';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { postTransaction } from '@/server/ledger';
import { D } from '@/server/money';
import { accessibleEntityIds, assertCan } from '@/server/permissions';
import { requireStepUp } from '@/server/totp';
import { cancelAdvanceOnReversal, recomputeAdvanceStatus } from '../advances/service';

/**
 * Contre-passation (règle 5) : écritures inverses liées à l'originale, motif obligatoire,
 * audit. L'originale passe à REVERSED ; rien n'est jamais supprimé.
 * Date de la contre-passation = aujourd'hui (jamais antidatée).
 */
export async function reverseTransaction(actor: CurrentUser, txId: string, reason: string, meta: RequestMeta) {
  if (reason.trim().length < 5) throw new AppError('REASON_REQUIRED', 400, 'Motif obligatoire');

  const original = await prisma.financialTransaction.findUnique({
    where: { id: txId },
    include: { entries: true, fx: true },
  });
  if (!original || !accessibleEntityIds(actor).includes(original.entityId)) {
    throw new AppError('NOT_FOUND', 404, 'Opération introuvable');
  }
  assertCan(actor, 'transaction.reverse', original.entityId);
  requireStepUp(actor); // SPEC §9

  return prisma.$transaction(async (tx) => {
    // Verrou de l'originale : deux contre-passations simultanées ne passent pas toutes les deux.
    const locked = await tx.$queryRaw<{ status: string }[]>`
      SELECT "status" FROM "FinancialTransaction" WHERE "id" = ${txId} FOR UPDATE`;
    if (locked[0]?.status !== 'POSTED') {
      throw new AppError('ALREADY_REVERSED', 409, 'Cette opération est déjà contre-passée');
    }
    if (original.kind === 'REVERSAL') {
      throw new AppError('CANNOT_REVERSE_REVERSAL', 409, 'Une contre-passation ne peut pas être contre-passée');
    }

    // Avance : le décaissement ne s'annule que sans remboursement actif (le remboursement se contre-passe seul).
    if (original.kind === 'ADVANCE_DISBURSEMENT' && original.advanceId) {
      await cancelAdvanceOnReversal(tx, original.advanceId);
    }

    const inverse = original.fx
      ? {
          fromAmount: D(original.fx.toAmount), fromCurrency: original.fx.toCurrency,
          toAmount: D(original.fx.fromAmount), toCurrency: original.fx.fromCurrency,
          rate: round6(D(original.fx.fromAmount).div(D(original.fx.toAmount))),
          rateDate: original.fx.rateDate, rateSource: original.fx.rateSource,
        }
      : undefined;

    const reversal = await postTransaction(tx, {
      entityId: original.entityId,
      kind: 'REVERSAL',
      date: new Date(),
      description: `Contre-passation de ${original.reference} — ${reason.trim()}`,
      createdById: actor.id,
      lines: original.entries.map((e) => ({ accountId: e.accountId, amount: D(e.amount).negated() })),
      fx: inverse,
      reversalOfId: original.id,
      reversalReason: reason.trim(),
      ip: meta.ip,
    });
    await tx.financialTransaction.update({ where: { id: original.id }, data: { status: 'REVERSED' } });
    if (original.kind === 'ADVANCE_REPAYMENT' && original.advanceId) {
      await recomputeAdvanceStatus(tx, original.advanceId); // le restant dû est recalculé
    }
    await writeAudit(tx, {
      actorId: actor.id, action: 'transaction.reverse', entityType: 'FinancialTransaction', entityId: original.id,
      before: { status: 'POSTED' }, after: { status: 'REVERSED', reversalId: reversal.id, reason: reason.trim() }, ip: meta.ip,
    });
    return reversal;
  });
}

const round6 = (v: ReturnType<typeof D>) => v.toDecimalPlaces(6);
