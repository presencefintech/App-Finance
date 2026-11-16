import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import type { Currency } from '@/generated/prisma/enums';
import { can } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { writeAudit } from '@/server/audit';
import type { CurrentUser, RequestMeta } from '@/server/auth';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { D, toMoneyString, type Money } from '@/server/money';
import { assertCan, assertEntityAccess } from '@/server/permissions';
import { requireStepUp } from '@/server/totp';

type Tx = Prisma.TransactionClient;

/** Montant à partir duquel un justificatif est obligatoire ; null = facultatif. */
export async function getEvidenceThreshold(db: Tx | typeof prisma, entityId: string, currency: Currency): Promise<Money | null> {
  const row = await db.evidenceThreshold.findUnique({ where: { entityId_currency: { entityId, currency } } });
  return row ? D(row.minAmount) : null;
}

/**
 * Refuse l'opération si son montant atteint le seuil de l'entité et qu'aucune pièce n'est fournie.
 * À appeler AVANT l'écriture au grand livre (tout est de toute façon dans la même transaction).
 */
export async function assertEvidenceProvided(
  tx: Tx, input: { entityId: string; amount: string; currency: Currency; attachmentIds?: string[] },
) {
  if (input.attachmentIds?.length) return;
  const threshold = await getEvidenceThreshold(tx, input.entityId, input.currency);
  if (threshold && D(input.amount).gte(threshold)) {
    throw new AppError(
      'EVIDENCE_REQUIRED', 422,
      `Un justificatif est obligatoire à partir de ${formatMoney(toMoneyString(threshold), input.currency)}`,
    );
  }
}

/**
 * Lie à l'opération les pièces déposées au préalable. Seules sont acceptées les pièces encore « en attente »
 * (ni opération ni demande), de la même entité et déposées par l'utilisateur lui-même ; sinon tout est annulé.
 */
export async function linkEvidence(
  tx: Tx, actor: CurrentUser,
  input: { entityId: string; txId: string; attachmentIds?: string[] }, meta: RequestMeta,
) {
  const ids = [...new Set(input.attachmentIds ?? [])];
  if (ids.length === 0) return;
  const { count } = await tx.attachment.updateMany({
    where: { id: { in: ids }, entityId: input.entityId, uploadedById: actor.id, txId: null, fundRequestId: null },
    data: { txId: input.txId },
  });
  if (count !== ids.length) {
    throw new AppError('INVALID_ATTACHMENT', 400, 'Justificatif introuvable ou déjà utilisé : redéposez le fichier');
  }
  for (const id of ids) {
    await writeAudit(tx, {
      actorId: actor.id, action: 'attachment.link', entityType: 'Attachment', entityId: id,
      after: { txId: input.txId }, ip: meta.ip,
    });
  }
}

/** Seuils d'une entité, pour les deux devises. Lisible par qui saisit des opérations ou administre l'entité. */
export async function listEvidenceThresholds(actor: CurrentUser, entityId: string) {
  assertEntityAccess(actor, entityId);
  if (!can(actor.roles, 'transaction.record', entityId) && !can(actor.roles, 'settings.manage', entityId)) {
    throw new AppError('FORBIDDEN', 403, 'Action non autorisée pour cette entité');
  }
  const rows = await prisma.evidenceThreshold.findMany({ where: { entityId } });
  return (['USD', 'CDF'] as const).map((currency) => {
    const row = rows.find((r) => r.currency === currency);
    return { entityId, currency, minAmount: row ? toMoneyString(D(row.minAmount)) : null };
  });
}

/** Modification d'un seuil : opération sensible ⇒ step-up 2FA + audit avant/après. `minAmount` null = justificatif facultatif. */
export async function setEvidenceThreshold(
  actor: CurrentUser, i: { entityId: string; currency: Currency; minAmount: string | null }, meta: RequestMeta,
) {
  assertEntityAccess(actor, i.entityId);
  assertCan(actor, 'settings.manage', i.entityId);
  requireStepUp(actor);
  return prisma.$transaction(async (tx) => {
    const key = { entityId_currency: { entityId: i.entityId, currency: i.currency } };
    const before = await tx.evidenceThreshold.findUnique({ where: key });
    let row: { id: string } | null = before;
    if (i.minAmount === null) {
      if (before) await tx.evidenceThreshold.delete({ where: key });
    } else {
      row = await tx.evidenceThreshold.upsert({
        where: key, update: { minAmount: i.minAmount },
        create: { entityId: i.entityId, currency: i.currency, minAmount: i.minAmount },
      });
    }
    await writeAudit(tx, {
      actorId: actor.id, action: 'settings.evidence-threshold', entityType: 'EvidenceThreshold',
      entityId: row?.id ?? `${i.entityId}:${i.currency}`,
      before: { minAmount: before ? toMoneyString(D(before.minAmount)) : 'aucun' },
      after: { minAmount: i.minAmount ?? 'aucun', currency: i.currency }, ip: meta.ip,
    });
    return { entityId: i.entityId, currency: i.currency, minAmount: i.minAmount };
  });
}
