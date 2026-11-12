import 'server-only';
import { can, type Permission } from '@/lib/permissions';
import type { CurrentUser } from './auth';
import { AppError } from './errors';

/** À appeler dans les services : refuse si l'utilisateur n'a pas la permission DANS cette entité. */
export function assertCan(user: CurrentUser, permission: Permission, entityId: string): void {
  if (!can(user.roles, permission, entityId)) {
    throw new AppError('FORBIDDEN', 403, 'Action non autorisée pour cette entité');
  }
}

/** Entités visibles par l'utilisateur (règle 9 : toute requête filtrée par entityId). */
export function accessibleEntityIds(user: CurrentUser): string[] {
  return [...new Set(user.roles.map((r) => r.entityId))];
}

/** Entités où l'utilisateur détient la permission (lecture comprise) : à utiliser pour filtrer les listes. */
export function readableEntityIds(user: CurrentUser, permission: Permission): string[] {
  return [...new Set(user.roles.filter((r) => can(user.roles, permission, r.entityId)).map((r) => r.entityId))];
}

export function assertEntityAccess(user: CurrentUser, entityId: string): void {
  if (!accessibleEntityIds(user).includes(entityId)) {
    throw new AppError('FORBIDDEN', 403, 'Entité inaccessible');
  }
}
