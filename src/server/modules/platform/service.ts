import 'server-only';
import { Prisma } from '@/generated/prisma/client';
import type { CreateOrganizationInput } from '@/lib/schemas/platform';
import { hashPassword, type CurrentUser, type RequestMeta } from '@/server/auth';
import { hasPlatformDb, platformDb as ownerDb } from '@/server/db';
import { AppError } from '@/server/errors';
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from '@/server/modules/entities/defaults';

/**
 * Administration de la PLATEFORME : création et suspension des organisations clientes.
 * Utilise le rôle propriétaire (contourne la RLS) ; chaque fonction exige un administrateur de plateforme.
 * Un administrateur de plateforme n'appartient à aucune organisation et ne voit aucune donnée financière.
 */
function assertPlatform(actor: CurrentUser) {
  if (!actor.isPlatformAdmin) throw new AppError('FORBIDDEN', 403, 'Réservé à l’administration de la plateforme');
}

/** Les identifiants propriétaires ne sont volontairement pas présents sur tous les déploiements. */
export function platformAdminAvailable(): boolean {
  return hasPlatformDb();
}

function platformDb() {
  if (!hasPlatformDb()) {
    throw new AppError('PLATFORM_ADMIN_UNAVAILABLE', 503, 'La gestion des organisations n’est pas activée sur ce déploiement (PLATFORM_DATABASE_URL absente). Utilisez l’application où elle est activée.');
  }
  return ownerDb();
}

const DEFAULT_INCOME = DEFAULT_INCOME_CATEGORIES;
const DEFAULT_EXPENSE = DEFAULT_EXPENSE_CATEGORIES;

export async function listOrganizations(actor: CurrentUser) {
  assertPlatform(actor);
  const db = platformDb();
  const orgs = await db.organization.findMany({ orderBy: { createdAt: 'asc' } });
  const [entities, users] = await Promise.all([
    db.entity.groupBy({ by: ['organizationId'], _count: true }),
    db.user.groupBy({ by: ['organizationId'], _count: true }),
  ]);
  return orgs.map((o) => ({
    id: o.id, name: o.name, slug: o.slug, isActive: o.isActive, createdAt: o.createdAt,
    entities: entities.find((e) => e.organizationId === o.id)?._count ?? 0,
    users: users.find((u) => u.organizationId === o.id)?._count ?? 0,
  }));
}

export async function createOrganization(actor: CurrentUser, input: CreateOrganizationInput, meta: RequestMeta) {
  assertPlatform(actor);
  const passwordHash = await hashPassword(input.adminPassword);
  const db = platformDb();
  try {
    return await db.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: input.name, slug: input.slug } });
      const entity = await tx.entity.create({
        data: { organizationId: org.id, code: input.entityCode, prefix: input.entityPrefix, name: input.entityName },
      });
      const admin = await tx.user.create({
        data: { organizationId: org.id, email: input.adminEmail, fullName: input.adminName, passwordHash },
      });
      await tx.userEntityRole.create({ data: { organizationId: org.id, userId: admin.id, entityId: entity.id, role: 'ADMIN' } });
      await tx.category.createMany({
        data: [
          ...DEFAULT_INCOME.map((name) => ({ organizationId: org.id, entityId: entity.id, kind: 'INCOME' as const, name })),
          ...DEFAULT_EXPENSE.map((name) => ({ organizationId: org.id, entityId: entity.id, kind: 'EXPENSE' as const, name })),
        ],
      });
      // Événement de plateforme : volontairement sans organisation (invisible des tenants).
      await tx.auditLog.create({
        data: {
          organizationId: null, actorId: actor.id, action: 'platform.organization.create', entityType: 'Organization', entityId: org.id,
          after: { name: org.name, slug: org.slug, entity: input.entityCode, admin: input.adminEmail }, ip: meta.ip,
        },
      });
      return { id: org.id, name: org.name, slug: org.slug, entityId: entity.id, adminId: admin.id };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const target = JSON.stringify(e.meta ?? {});
      if (target.includes('email')) throw new AppError('EMAIL_TAKEN', 409, 'Cet e-mail est déjà utilisé');
      if (target.includes('slug')) throw new AppError('SLUG_TAKEN', 409, 'Cet identifiant d’organisation existe déjà');
      throw new AppError('ALREADY_EXISTS', 409, 'Une valeur unique existe déjà');
    }
    throw e;
  }
}

/** Suspension / réactivation : une organisation suspendue perd immédiatement tout accès (sessions invalidées). */
export async function setOrganizationActive(actor: CurrentUser, id: string, isActive: boolean, meta: RequestMeta) {
  assertPlatform(actor);
  const db = platformDb();
  return db.$transaction(async (tx) => {
    const before = await tx.organization.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND', 404, 'Organisation introuvable');
    const org = await tx.organization.update({ where: { id }, data: { isActive } });
    if (!isActive) await tx.session.deleteMany({ where: { user: { organizationId: id } } });
    await tx.auditLog.create({
      data: {
        organizationId: null, actorId: actor.id, action: 'platform.organization.set-active', entityType: 'Organization', entityId: id,
        before: { isActive: before.isActive }, after: { isActive: org.isActive }, ip: meta.ip,
      },
    });
    return { id: org.id, isActive: org.isActive };
  });
}
