import 'server-only';
import type { CurrentUser, RequestMeta } from '@/server/auth';
import { writeAudit } from '@/server/audit';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { accessibleEntityIds, assertCan, assertEntityAccess } from '@/server/permissions';

const isUnique = (e: unknown) => typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2002';

export async function listCategories(actor: CurrentUser, entityId?: string) {
  const ids = accessibleEntityIds(actor).filter((id) => !entityId || id === entityId);
  return prisma.category.findMany({ where: { entityId: { in: ids } }, orderBy: [{ kind: 'asc' }, { name: 'asc' }] });
}

export async function listDepartments(actor: CurrentUser, entityId?: string) {
  const ids = accessibleEntityIds(actor).filter((id) => !entityId || id === entityId);
  return prisma.department.findMany({ where: { entityId: { in: ids } }, orderBy: { name: 'asc' } });
}

export async function createCategory(actor: CurrentUser, i: { entityId: string; kind: 'INCOME' | 'EXPENSE'; name: string }, meta: RequestMeta) {
  assertEntityAccess(actor, i.entityId);
  assertCan(actor, 'settings.manage', i.entityId);
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.category.create({ data: i });
      await writeAudit(tx, { actorId: actor.id, action: 'category.create', entityType: 'Category', entityId: row.id, after: i, ip: meta.ip });
      return row;
    });
  } catch (e) {
    if (isUnique(e)) throw new AppError('ALREADY_EXISTS', 409, 'Cette catégorie existe déjà');
    throw e;
  }
}

export async function updateCategory(actor: CurrentUser, id: string, i: { name?: string; isActive?: boolean }, meta: RequestMeta) {
  const before = await prisma.category.findUnique({ where: { id } });
  if (!before || !accessibleEntityIds(actor).includes(before.entityId)) throw new AppError('NOT_FOUND', 404, 'Catégorie introuvable');
  assertCan(actor, 'settings.manage', before.entityId);
  return prisma.$transaction(async (tx) => {
    const after = await tx.category.update({ where: { id }, data: i });
    await writeAudit(tx, {
      actorId: actor.id, action: 'category.update', entityType: 'Category', entityId: id,
      before: { name: before.name, isActive: before.isActive }, after: { name: after.name, isActive: after.isActive }, ip: meta.ip,
    });
    return after;
  });
}

export async function createDepartment(actor: CurrentUser, i: { entityId: string; name: string }, meta: RequestMeta) {
  assertEntityAccess(actor, i.entityId);
  assertCan(actor, 'settings.manage', i.entityId);
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.department.create({ data: i });
      await writeAudit(tx, { actorId: actor.id, action: 'department.create', entityType: 'Department', entityId: row.id, after: i, ip: meta.ip });
      return row;
    });
  } catch (e) {
    if (isUnique(e)) throw new AppError('ALREADY_EXISTS', 409, 'Ce département existe déjà');
    throw e;
  }
}
