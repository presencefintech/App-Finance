import type { Role } from '@/generated/prisma/enums';

export const PERMISSIONS = [
  'user.manage',
  'account.manage',
  'account.read',
  'fx.manage',
  'settings.manage',
  'audit.read',
  'report.read',
  'fundRequest.create',
  'fundRequest.review',
  'fundRequest.approve',
  'fundRequest.disburse',
  'fundRequest.close',
  'transaction.record',
  'transaction.reverse',
  'cash.close',
  'cash.validate',
  'advance.manage',
  'budget.manage',
  'reconciliation.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Rôles pouvant gérer les accès et les paramètres de l'organisation (ADMIN et DIRECTOR). */
export const MANAGER_ROLES: readonly Role[] = ['ADMIN', 'DIRECTOR'];

/** Matrice rôle → permissions (SPEC §3). ADMIN n'enregistre aucune opération financière. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ['user.manage', 'settings.manage', 'account.manage', 'account.read', 'audit.read', 'report.read'],
  CONTROLLER: [
    'account.manage', 'account.read', 'fx.manage',
    'audit.read', 'report.read', 'fundRequest.review', 'fundRequest.approve', 'fundRequest.close',
    'transaction.record', 'transaction.reverse', 'cash.close', 'cash.validate', 'advance.manage', 'budget.manage', 'reconciliation.manage',
  ],
  DIRECTOR: ['user.manage', 'settings.manage', 'account.read', 'budget.manage', 'audit.read', 'report.read', 'fundRequest.approve', 'transaction.reverse'],
  CASHIER: ['account.read', 'fundRequest.disburse', 'transaction.record', 'cash.close'],
  REQUESTER: ['fundRequest.create'],
  VIEWER: ['account.read', 'report.read'],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Rôles de l'utilisateur dans UNE entité donnée → a-t-il la permission ? */
export function can(
  roles: readonly { entityId: string; role: Role }[],
  permission: Permission,
  entityId: string,
): boolean {
  return roles.some((r) => r.entityId === entityId && roleHasPermission(r.role, permission));
}
