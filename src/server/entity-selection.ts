import 'server-only';
import { cookies } from 'next/headers';
import type { CurrentUser } from './auth';
import { prisma } from './db';
import { accessibleEntityIds } from './permissions';

export const ENTITY_COOKIE = 'sfc_entity';
/** 'ALL' = toutes les entités de l'organisation ; sinon le code d'une entité (ex. SEC). */
export type EntitySelection = string;

/**
 * Entités affichées d'après le sélecteur global (cookie), bornées aux droits de l'utilisateur ET (par la RLS) à son
 * organisation. 'ALL' = vue consolidée de l'organisation : les entités restent côte à côte, jamais fusionnées.
 */
export async function getSelectedEntities(user: CurrentUser) {
  const raw = (await cookies()).get(ENTITY_COOKIE)?.value;
  const all = await prisma.entity.findMany({
    where: { id: { in: accessibleEntityIds(user) } },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });
  const chosen = raw && raw !== 'ALL' ? all.filter((e) => e.code === raw) : [];
  const selection: EntitySelection = chosen.length > 0 ? raw! : 'ALL';
  return { selection, entities: chosen.length > 0 ? chosen : all, available: all };
}
