import type { Role } from '@/generated/prisma/enums';
import { roleHasPermission, type Permission } from './permissions';

export type NavIcon =
  | 'dashboard' | 'requests' | 'income' | 'expense' | 'cash' | 'bank' | 'advances' | 'budgets' | 'reconciliation'
  | 'rates' | 'reports' | 'registers' | 'audit' | 'settings' | 'profile';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Visible si l'utilisateur détient AU MOINS UNE de ces permissions (dans une entité quelconque)… */
  permissions?: Permission[];
  /** …ou l'un de ces rôles. Sans condition : visible par tout utilisateur connecté. */
  roles?: Role[];
}

/**
 * Source unique de vérité du menu ET des gardes de page : un rôle ne voit et n'atteint que ce que la matrice
 * des permissions (src/lib/permissions.ts) lui accorde. Les services refont toujours le contrôle côté serveur.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Tableau de bord', icon: 'dashboard', permissions: ['account.read'] },
  { href: '/demandes', label: 'Demandes de fonds', icon: 'requests', permissions: ['fundRequest.create', 'fundRequest.review', 'fundRequest.approve', 'fundRequest.disburse', 'fundRequest.close'], roles: ['VIEWER'] },
  { href: '/recettes', label: 'Recettes', icon: 'income', permissions: ['account.read'] },
  { href: '/depenses', label: 'Dépenses', icon: 'expense', permissions: ['account.read'] },
  { href: '/caisses', label: 'Caisses', icon: 'cash', permissions: ['account.read'] },
  { href: '/banques', label: 'Banques', icon: 'bank', permissions: ['account.read'] },
  { href: '/avances', label: 'Avances', icon: 'advances', permissions: ['account.read'] },
  { href: '/taux-de-change', label: 'Taux de change', icon: 'rates', permissions: ['account.read'] },
  { href: '/budgets', label: 'Budgets', icon: 'budgets', permissions: ['account.read'] },
  { href: '/rapprochements', label: 'Rapprochements', icon: 'reconciliation', permissions: ['reconciliation.manage'] },
  { href: '/rapports', label: 'Rapports', icon: 'reports', permissions: ['report.read'] },
  { href: '/registres', label: 'Registres', icon: 'registers', permissions: ['account.read'] },
  { href: '/audit', label: 'Audit', icon: 'audit', permissions: ['audit.read'] },
  { href: '/parametres', label: 'Paramètres', icon: 'settings', permissions: ['settings.manage'] },
  { href: '/profil', label: 'Mon profil', icon: 'profile' },
];

export function canSee(item: NavItem, roles: readonly { role: Role }[]): boolean {
  if (!item.permissions && !item.roles) return true;
  return roles.some(
    (r) => item.roles?.includes(r.role) || item.permissions?.some((p) => roleHasPermission(r.role, p)),
  );
}

export const visibleNav = (roles: readonly { role: Role }[]): NavItem[] => NAV_ITEMS.filter((i) => canSee(i, roles));

/** Page d'atterrissage : le tableau de bord si autorisé, sinon la première page accessible. */
export function landingPath(roles: readonly { role: Role }[]): string {
  return visibleNav(roles)[0]?.href ?? '/profil';
}

/** L'URL (ex. /parametres/utilisateurs) est-elle accessible ? On compare au préfixe de menu le plus long. */
export function canAccessPath(path: string, roles: readonly { role: Role }[]): boolean {
  const match = [...NAV_ITEMS].filter((i) => (i.href === '/' ? path === '/' : path === i.href || path.startsWith(`${i.href}/`))).sort((a, b) => b.href.length - a.href.length)[0];
  return match ? canSee(match, roles) : true;
}
