import 'server-only';
import type { CurrentUser } from '@/server/auth';
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

/** Nom de l'organisation de l'utilisateur (la RLS ne laisse voir que la sienne). */
export async function getOrganizationName(): Promise<string | null> {
  return (await prisma.organization.findFirst({ select: { name: true } }))?.name ?? null;
}
