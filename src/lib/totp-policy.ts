import type { Role } from '@/generated/prisma/enums';

/** SPEC §9 : 2FA obligatoire pour ces rôles (dans au moins une entité). */
export const TOTP_REQUIRED_ROLES: readonly Role[] = ['ADMIN', 'CONTROLLER', 'DIRECTOR', 'CASHIER'];

/**
 * Interrupteur d'environnement (démo / recette) : DISABLE_2FA=true supprime l'enrôlement obligatoire, le code au
 * login et le step-up. Par défaut la 2FA est ACTIVE (SPEC §9) ; ne jamais poser ce réglage en production réelle.
 */
export const twoFactorDisabled = () => process.env.DISABLE_2FA === 'true';

export function isTotpRequired(roles: readonly { role: Role }[]): boolean {
  return roles.some((r) => TOTP_REQUIRED_ROLES.includes(r.role));
}
