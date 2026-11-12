import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import type { EntityCode } from '@/generated/prisma/enums';

const PREFIX: Record<EntityCode, string> = { SEC: 'SEC', ECOLE: 'ECO' };

/**
 * Référence séquentielle par (entité, type, année) : SEC-DF-2026-00042.
 * Compteur incrémenté atomiquement dans la transaction appelante (pas de trou en cas de rollback).
 */
export async function nextReference(
  tx: Prisma.TransactionClient,
  entityCode: EntityCode,
  docType: string,
  date: Date = new Date(),
): Promise<string> {
  const year = date.getUTCFullYear();
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "ReferenceCounter" ("entityCode", "docType", "year", "lastValue")
    VALUES (${entityCode}::"EntityCode", ${docType}, ${year}, 1)
    ON CONFLICT ("entityCode", "docType", "year")
    DO UPDATE SET "lastValue" = "ReferenceCounter"."lastValue" + 1
    RETURNING "lastValue"`;
  const value = rows[0]?.lastValue;
  if (value === undefined) throw new Error('reference counter failed');
  return `${PREFIX[entityCode]}-${docType}-${year}-${String(value).padStart(5, '0')}`;
}
