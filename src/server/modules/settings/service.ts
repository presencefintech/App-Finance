import 'server-only';
import type { Currency } from '@/generated/prisma/enums';
import { writeAudit } from '@/server/audit';
import type { CurrentUser, RequestMeta } from '@/server/auth';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { D, toMoneyString } from '@/server/money';
import { accessibleEntityIds, assertCan, assertEntityAccess } from '@/server/permissions';
import { approvalLimit } from '@/server/settings';
import { requireStepUp } from '@/server/totp';

/** Paramètres globaux modifiables par l'ADMIN (liste blanche) et leur valeur par défaut. */
export const APP_SETTINGS = {
  allowSameApproverCashier: { default: 'false', check: (v: string) => v === 'true' || v === 'false' },
  advanceAlertDays: { default: '30', check: (v: string) => /^\d{1,3}$/.test(v) && Number(v) > 0 },
} as const;
export type AppSettingKey = keyof typeof APP_SETTINGS;

export async function listApprovalLimits(actor: CurrentUser, entityId: string) {
  assertEntityAccess(actor, entityId);
  assertCan(actor, 'settings.manage', entityId);
  const out = [];
  for (const role of ['CONTROLLER', 'DIRECTOR'] as const) {
    for (const currency of ['USD', 'CDF'] as const) {
      const limit = await approvalLimit(prisma, entityId, role, currency);
      const explicit = await prisma.approvalLimit.findUnique({ where: { entityId_role_currency: { entityId, role, currency } } });
      out.push({ entityId, role, currency, maxAmount: limit ? toMoneyString(limit) : null, isDefault: !explicit });
    }
  }
  return out;
}

/** Modification d'un plafond : opération sensible (SPEC §9) ⇒ step-up + audit avant/après. */
export async function setApprovalLimit(
  actor: CurrentUser,
  i: { entityId: string; role: 'CONTROLLER' | 'DIRECTOR'; currency: Currency; maxAmount: string },
  meta: RequestMeta,
) {
  assertEntityAccess(actor, i.entityId);
  assertCan(actor, 'settings.manage', i.entityId);
  requireStepUp(actor);
  return prisma.$transaction(async (tx) => {
    const before = await tx.approvalLimit.findUnique({ where: { entityId_role_currency: { entityId: i.entityId, role: i.role, currency: i.currency } } });
    const row = await tx.approvalLimit.upsert({
      where: { entityId_role_currency: { entityId: i.entityId, role: i.role, currency: i.currency } },
      update: { maxAmount: i.maxAmount },
      create: { entityId: i.entityId, role: i.role, currency: i.currency, maxAmount: i.maxAmount },
    });
    await writeAudit(tx, {
      actorId: actor.id, action: 'settings.approval-limit', entityType: 'ApprovalLimit', entityId: row.id,
      before: before ? { maxAmount: toMoneyString(D(before.maxAmount)) } : { maxAmount: 'défaut' },
      after: { maxAmount: toMoneyString(D(row.maxAmount)), role: i.role, currency: i.currency }, ip: meta.ip,
    });
    return { entityId: i.entityId, role: i.role, currency: i.currency, maxAmount: toMoneyString(D(row.maxAmount)) };
  });
}

function assertAdminSomewhere(actor: CurrentUser) {
  const entityId = actor.roles.find((r) => r.role === 'ADMIN')?.entityId;
  if (!entityId) throw new AppError('FORBIDDEN', 403, 'Réservé aux administrateurs');
  assertCan(actor, 'settings.manage', entityId);
  if (!accessibleEntityIds(actor).includes(entityId)) throw new AppError('FORBIDDEN', 403, 'Réservé aux administrateurs');
}

export async function getAppSettings(actor: CurrentUser) {
  assertAdminSomewhere(actor);
  const rows = await prisma.setting.findMany();
  return (Object.keys(APP_SETTINGS) as AppSettingKey[]).map((key) => ({
    key, value: rows.find((r) => r.key === key)?.value ?? APP_SETTINGS[key].default, default: APP_SETTINGS[key].default,
  }));
}

export async function setAppSetting(actor: CurrentUser, key: string, value: string, meta: RequestMeta) {
  assertAdminSomewhere(actor);
  if (!(key in APP_SETTINGS)) throw new AppError('VALIDATION_ERROR', 400, 'Paramètre inconnu');
  const def = APP_SETTINGS[key as AppSettingKey];
  if (!def.check(value)) throw new AppError('VALIDATION_ERROR', 400, 'Valeur invalide');
  requireStepUp(actor); // lever la séparation approbateur/caissier est sensible
  return prisma.$transaction(async (tx) => {
    // Un réglage par (organisation, clé) : la RLS borne la recherche à l'organisation courante.
    const before = await tx.setting.findFirst({ where: { key } });
    if (before) await tx.setting.update({ where: { id: before.id }, data: { value } });
    else await tx.setting.create({ data: { key, value } });
    await writeAudit(tx, {
      actorId: actor.id, action: 'settings.update', entityType: 'Setting', entityId: key,
      before: { value: before?.value ?? def.default }, after: { value }, ip: meta.ip,
    });
    return { key, value };
  });
}
