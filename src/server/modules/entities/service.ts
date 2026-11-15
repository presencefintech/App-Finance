import 'server-only';
import { Prisma } from '@/generated/prisma/client';
import type { CreateEntityInput } from '@/lib/schemas/entities';
import { writeAudit } from '@/server/audit';
import type { CurrentUser, RequestMeta } from '@/server/auth';
import { AppError } from '@/server/errors';
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from '@/server/modules/entities/defaults';
import { prisma } from '@/server/db';
import { accessibleEntityIds } from '@/server/permissions';

/** Entités visibles par l'utilisateur uniquement (règle 9). */
export async function listEntities(user: CurrentUser) {
  return prisma.entity.findMany({
    where: { id: { in: accessibleEntityIds(user) } },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });
}

/** Noms de toutes les entités (id + nom uniquement) : nécessaire pour choisir l'entité bénéficiaire d'une avance. */
export async function listAllEntityNames() {
  return prisma.entity.findMany({ select: { id: true, name: true }, orderBy: { code: 'asc' } });
}

/** Code d'entité de l'organisation | « ALL » (ou vide) → identifiants d'entités, bornés aux droits de l'utilisateur. */
export async function resolveEntityIds(user: CurrentUser, selection?: string | null): Promise<string[]> {
  const code = selection && selection !== 'ALL' ? selection : null;
  const rows = await prisma.entity.findMany({
    where: { id: { in: accessibleEntityIds(user) }, ...(code ? { code } : {}) },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Création d'une entité supplémentaire dans l'organisation (réservée aux administrateurs).
 * Catégories par défaut ; le créateur reçoit le rôle ADMIN sur la nouvelle entité pour pouvoir la configurer.
 */
export async function createEntity(actor: CurrentUser, input: CreateEntityInput, meta: RequestMeta) {
  if (!actor.roles.some((r) => r.role === 'ADMIN')) throw new AppError('FORBIDDEN', 403, 'Réservé aux administrateurs');
  try {
    return await prisma.$transaction(async (tx) => {
      const entity = await tx.entity.create({ data: { code: input.code, prefix: input.prefix, name: input.name }, select: { id: true, code: true, name: true } });
      await tx.userEntityRole.create({ data: { userId: actor.id, entityId: entity.id, role: 'ADMIN' } });
      await tx.category.createMany({
        data: [
          ...DEFAULT_INCOME_CATEGORIES.map((name) => ({ entityId: entity.id, kind: 'INCOME' as const, name })),
          ...DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ entityId: entity.id, kind: 'EXPENSE' as const, name })),
        ],
      });
      await writeAudit(tx, {
        actorId: actor.id, action: 'entity.create', entityType: 'Entity', entityId: entity.id,
        after: { code: entity.code, name: entity.name, prefix: input.prefix }, ip: meta.ip,
      });
      return entity;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new AppError('ALREADY_EXISTS', 409, 'Ce code ou ce préfixe d’entité existe déjà');
    }
    throw e;
  }
}

/** Nom de l'organisation de l'utilisateur (la RLS ne laisse voir que la sienne). */
export async function getOrganizationName(): Promise<string | null> {
  return (await prisma.organization.findFirst({ select: { name: true } }))?.name ?? null;
}
