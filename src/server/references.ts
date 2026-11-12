import 'server-only';
import type { Prisma } from '@/generated/prisma/client';

/**
 * Référence séquentielle par (entité, type, année) : SEC-DF-2026-00042. Le préfixe vient de l'entité ;
 * l'unicité est garantie PAR ORGANISATION (deux clients peuvent avoir le même préfixe).
 * Compteur incrémenté atomiquement dans la transaction appelante (pas de trou en cas de rollback).
 */
export async function nextReference(
  tx: Prisma.TransactionClient,
  entityId: string,
  docType: string,
  date: Date = new Date(),
): Promise<string> {
  const entity = await tx.entity.findUniqueOrThrow({ where: { id: entityId }, select: { prefix: true } });
  const year = date.getUTCFullYear();
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "ReferenceCounter" ("entityId", "docType", "year", "lastValue")
    VALUES (${entityId}, ${docType}, ${year}, 1)
    ON CONFLICT ("entityId", "docType", "year")
    DO UPDATE SET "lastValue" = "ReferenceCounter"."lastValue" + 1
    RETURNING "lastValue"`;
  const value = rows[0]?.lastValue;
  if (value === undefined) throw new Error('reference counter failed');
  return `${entity.prefix}-${docType}-${year}-${String(value).padStart(5, '0')}`;
}
