import 'server-only';
import { cookies } from 'next/headers';
import type { CurrentUser } from './auth';
import { prisma } from './db';
import { accessibleEntityIds } from './permissions';

export const ENTITY_COOKIE = 'sfc_entity';
export type EntitySelection = 'SEC' | 'ECOLE' | 'ALL';

/**
 * Entités affichées d'après le sélecteur global (cookie), toujours bornées aux droits de l'utilisateur.
 * 'ALL' = vue consolidée : les entités restent côte à côte, jamais fusionnées (règle 9).
 */
export async function getSelectedEntities(user: CurrentUser) {
  const raw = (await cookies()).get(ENTITY_COOKIE)?.value;
  const selection: EntitySelection = raw === 'SEC' || raw === 'ECOLE' ? raw : 'ALL';
  const entities = await prisma.entity.findMany({
    where: {
      id: { in: accessibleEntityIds(user) },
      ...(selection === 'ALL' ? {} : { code: selection }),
    },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });
  return { selection, entities };
}
