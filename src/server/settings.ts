import 'server-only';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import type { Currency } from '@/generated/prisma/enums';
import { D, type Money } from './money';

type Db = PrismaClient | Prisma.TransactionClient;

/** Valeurs par défaut configurables (SPEC §13) — signalées au client, modifiables par l'ADMIN. */
const DEFAULT_CONTROLLER_LIMIT: Record<Currency, string> = { USD: '500', CDF: '1400000' };
/** Seuil au-delà duquel l'approbation exige une 2FA récente (step-up). */
const DEFAULT_STEP_UP_THRESHOLD: Record<Currency, string> = { USD: '250', CDF: '700000' };

export async function getSetting(db: Db, key: string): Promise<string | null> {
  return (await db.setting.findUnique({ where: { key } }))?.value ?? null;
}

/** Équipe trop petite : l'approbateur peut aussi décaisser (mention dans l'audit). Défaut : non. */
export async function allowSameApproverCashier(db: Db): Promise<boolean> {
  return (await getSetting(db, 'allowSameApproverCashier')) === 'true';
}

/** Plafond d'approbation d'un rôle ; null = illimité. */
export async function approvalLimit(
  db: Db, entityId: string, role: 'CONTROLLER' | 'DIRECTOR', currency: Currency,
): Promise<Money | null> {
  const row = await db.approvalLimit.findUnique({ where: { entityId_role_currency: { entityId, role, currency } } });
  if (row) return D(row.maxAmount);
  return role === 'CONTROLLER' ? D(DEFAULT_CONTROLLER_LIMIT[currency]) : null;
}

export const stepUpApprovalThreshold = (currency: Currency): Money => D(DEFAULT_STEP_UP_THRESHOLD[currency]);
