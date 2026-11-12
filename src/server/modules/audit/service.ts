import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import type { CurrentUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { accessibleEntityIds } from '@/server/permissions';

export interface AuditFilter {
  actorId?: string; entityType?: string; action?: string; from?: Date; to?: Date; limit?: number;
}

/** Types d'objets rattachés à une entité : résolus à la lecture pour appliquer la séparation des entités. */
async function entitiesOf(type: string, ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const put = (id: string, ...e: string[]) => out.set(id, e);
  switch (type) {
    case 'FundRequest': (await prisma.fundRequest.findMany({ where: { id: { in: ids } }, select: { id: true, entityId: true } })).forEach((r) => put(r.id, r.entityId)); break;
    case 'FinancialTransaction': (await prisma.financialTransaction.findMany({ where: { id: { in: ids } }, select: { id: true, entityId: true } })).forEach((r) => put(r.id, r.entityId)); break;
    case 'Account': (await prisma.account.findMany({ where: { id: { in: ids } }, select: { id: true, entityId: true } })).forEach((r) => put(r.id, r.entityId)); break;
    case 'PendingTransfer': (await prisma.pendingTransfer.findMany({ where: { id: { in: ids } }, select: { id: true, entityId: true } })).forEach((r) => put(r.id, r.entityId)); break;
    case 'Budget': (await prisma.budget.findMany({ where: { id: { in: ids } }, select: { id: true, entityId: true } })).forEach((r) => put(r.id, r.entityId)); break;
    case 'Attachment': (await prisma.attachment.findMany({ where: { id: { in: ids } }, select: { id: true, entityId: true } })).forEach((r) => put(r.id, r.entityId)); break;
    case 'InterEntityAdvance': (await prisma.interEntityAdvance.findMany({ where: { id: { in: ids } }, select: { id: true, lenderEntityId: true, borrowerEntityId: true } })).forEach((r) => put(r.id, r.lenderEntityId, r.borrowerEntityId)); break;
    case 'CashSession': {
      const sessions = await prisma.cashSession.findMany({ where: { id: { in: ids } }, select: { id: true, accountId: true } });
      const accs = await prisma.account.findMany({ where: { id: { in: sessions.map((s) => s.accountId) } }, select: { id: true, entityId: true } });
      sessions.forEach((s) => { const a = accs.find((x) => x.id === s.accountId); if (a) put(s.id, a.entityId); });
      break;
    }
  }
  return out;
}

const ENTITY_BOUND = ['FundRequest', 'FinancialTransaction', 'Account', 'PendingTransfer', 'Budget', 'Attachment', 'InterEntityAdvance', 'CashSession'];
/** Journaux « globaux » (utilisateurs, paramètres, sessions) : réservés aux administrateurs. */
const ADMIN_ONLY = ['User', 'Setting', 'ApprovalLimit', 'Category', 'Department'];

/** Journal d'audit en lecture seule, restreint aux entités de l'utilisateur. */
export async function listAuditLogs(actor: CurrentUser, f: AuditFilter = {}) {
  const canRead = actor.roles.some((r) => ['ADMIN', 'CONTROLLER', 'DIRECTOR'].includes(r.role));
  if (!canRead) throw new AppError('FORBIDDEN', 403, 'Accès au journal d’audit refusé');
  const isAdmin = actor.roles.some((r) => r.role === 'ADMIN');
  const mine = new Set(accessibleEntityIds(actor));

  const where: Prisma.AuditLogWhereInput = {
    ...(f.actorId ? { actorId: f.actorId } : {}),
    ...(f.entityType ? { entityType: f.entityType } : {}),
    ...(f.action ? { action: { contains: f.action, mode: 'insensitive' } } : {}),
    ...(f.from || f.to ? { at: { gte: f.from, lte: f.to } } : {}),
  };
  const rows = await prisma.auditLog.findMany({ where, orderBy: { at: 'desc' }, take: 600 });

  // Résolution des entités par type, puis filtrage.
  const byType = new Map<string, string[]>();
  for (const r of rows) if (ENTITY_BOUND.includes(r.entityType)) byType.set(r.entityType, [...(byType.get(r.entityType) ?? []), r.entityId]);
  const resolved = new Map<string, Map<string, string[]>>();
  for (const [type, ids] of byType) resolved.set(type, await entitiesOf(type, [...new Set(ids)]));

  const visible = rows.filter((r) => {
    if (ENTITY_BOUND.includes(r.entityType)) {
      const ents = resolved.get(r.entityType)?.get(r.entityId);
      return Boolean(ents?.some((e) => mine.has(e)));
    }
    if (ADMIN_ONLY.includes(r.entityType)) return isAdmin;
    return true; // ExchangeRate, etc.
  }).slice(0, f.limit ?? 200);

  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(visible.map((r) => r.actorId).filter((x): x is string => Boolean(x)))] } }, select: { id: true, fullName: true } });
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  return visible.map((r) => ({
    id: r.id, at: r.at, action: r.action, entityType: r.entityType, entityId: r.entityId,
    actorName: r.actorId ? names.get(r.actorId) ?? 'Inconnu' : 'Système', ip: r.ip, before: r.before, after: r.after,
  }));
}
