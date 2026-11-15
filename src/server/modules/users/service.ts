import 'server-only';
import { Prisma } from '@/generated/prisma/client';
import type { CreateUserInput, RoleAssignment, UpdateUserInput } from '@/lib/schemas/users';
import { writeAudit } from '@/server/audit';
import { hashPassword, type CurrentUser, type RequestMeta } from '@/server/auth';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { MANAGER_ROLES } from '@/lib/permissions';
import { assertCan } from '@/server/permissions';

const userSelect = {
  id: true,
  email: true,
  fullName: true,
  isActive: true,
  totpEnabledAt: true,
  createdAt: true,
  roles: { select: { entityId: true, role: true } },
} satisfies Prisma.UserSelect;

/** user.manage doit être détenu dans au moins une entité ; la gestion des utilisateurs est transversale. */
function assertUserAdmin(actor: CurrentUser) {
  const entityId = actor.roles.find((r) => MANAGER_ROLES.includes(r.role))?.entityId;
  if (!entityId) throw new AppError('FORBIDDEN', 403, 'Réservé aux administrateurs et directeurs');
  assertCan(actor, 'user.manage', entityId);
}

const isAdmin = (actor: CurrentUser) => actor.roles.some((r) => r.role === 'ADMIN');

/**
 * Un directeur gère les accès, mais ne peut ni attribuer le rôle ADMIN, ni modifier un administrateur,
 * ni changer ses propres rôles (séparation des fonctions : on ne s'attribue pas de pouvoir financier).
 */
async function assertCanAssign(actor: CurrentUser, targetUserId: string | null, roles: RoleAssignment[]) {
  if (isAdmin(actor)) return;
  if (roles.some((r) => r.role === 'ADMIN')) throw new AppError('FORBIDDEN', 403, 'Seul un administrateur peut attribuer le rôle administrateur');
  if (targetUserId === actor.id) throw new AppError('FORBIDDEN', 403, 'Vous ne pouvez pas modifier vos propres rôles');
  if (targetUserId) {
    const target = await prisma.userEntityRole.count({ where: { userId: targetUserId, role: 'ADMIN' } });
    if (target > 0) throw new AppError('FORBIDDEN', 403, 'Seul un administrateur peut modifier un administrateur');
  }
}

export async function listUsers(actor: CurrentUser) {
  assertUserAdmin(actor);
  return prisma.user.findMany({ select: userSelect, orderBy: { createdAt: 'asc' } });
}

async function assertEntitiesExist(assignments: RoleAssignment[]) {
  const ids = [...new Set(assignments.map((a) => a.entityId))];
  const count = await prisma.entity.count({ where: { id: { in: ids } } });
  if (count !== ids.length) throw new AppError('VALIDATION_ERROR', 400, 'Entité inconnue');
}

export async function createUser(actor: CurrentUser, input: CreateUserInput, meta: RequestMeta) {
  assertUserAdmin(actor);
  await assertEntitiesExist(input.roles);
  await assertCanAssign(actor, null, input.roles);
  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          fullName: input.fullName,
          passwordHash,
          roles: { create: input.roles },
        },
        select: userSelect,
      });
      await writeAudit(tx, {
        actorId: actor.id, action: 'user.create', entityType: 'User', entityId: user.id,
        after: { email: user.email, fullName: user.fullName, roles: user.roles }, ip: meta.ip,
      });
      return user;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new AppError('EMAIL_TAKEN', 409, 'Cet e-mail est déjà utilisé');
    }
    throw e;
  }
}

export async function updateUser(actor: CurrentUser, userId: string, input: UpdateUserInput, meta: RequestMeta) {
  assertUserAdmin(actor);
  if (!isAdmin(actor) && (await prisma.userEntityRole.count({ where: { userId, role: 'ADMIN' } })) > 0) {
    throw new AppError('FORBIDDEN', 403, 'Seul un administrateur peut modifier un administrateur');
  }
  if (userId === actor.id && input.isActive === false) {
    throw new AppError('SELF_DEACTIVATION', 409, 'Vous ne pouvez pas désactiver votre propre compte');
  }
  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: userId }, select: userSelect });
    if (!before) throw new AppError('NOT_FOUND', 404, 'Utilisateur introuvable');
    const after = await tx.user.update({ where: { id: userId }, data: input, select: userSelect });
    if (input.isActive === false) await tx.session.deleteMany({ where: { userId } });
    await writeAudit(tx, {
      actorId: actor.id, action: 'user.update', entityType: 'User', entityId: userId,
      before: { fullName: before.fullName, isActive: before.isActive },
      after: { fullName: after.fullName, isActive: after.isActive }, ip: meta.ip,
    });
    return after;
  });
}

/** Remplace l'ensemble des rôles. Garde-fou : on ne peut pas retirer son propre rôle ADMIN. */
export async function setUserRoles(actor: CurrentUser, userId: string, roles: RoleAssignment[], meta: RequestMeta) {
  assertUserAdmin(actor);
  await assertEntitiesExist(roles);
  await assertCanAssign(actor, userId, roles);
  if (userId === actor.id && isAdmin(actor) && !roles.some((r) => r.role === 'ADMIN')) {
    throw new AppError('SELF_DEMOTION', 409, 'Vous ne pouvez pas retirer votre propre rôle administrateur');
  }
  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: userId }, select: userSelect });
    if (!before) throw new AppError('NOT_FOUND', 404, 'Utilisateur introuvable');
    await tx.userEntityRole.deleteMany({ where: { userId } });
    await tx.userEntityRole.createMany({ data: roles.map((r) => ({ userId, ...r })), skipDuplicates: true });
    const after = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: userSelect });
    await writeAudit(tx, {
      actorId: actor.id, action: 'user.roles.set', entityType: 'User', entityId: userId,
      before: { roles: before.roles }, after: { roles: after.roles }, ip: meta.ip,
    });
    return after;
  });
}
