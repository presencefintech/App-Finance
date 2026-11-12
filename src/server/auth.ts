import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import argon2 from 'argon2';
import type { Role } from '@/generated/prisma/enums';
import { cache } from 'react';
import { prisma, systemDb } from './db';
import { bindRscTenant, runInOrg } from './tenant';
import { AppError } from './errors';
import { writeAudit } from './audit';
import { decrypt } from './crypto';
import { verifyCode } from './totp';
import { isTotpRequired, twoFactorDisabled } from '@/lib/totp-policy';

export const SESSION_COOKIE = 'sfc_session';
const IDLE_MS = 30 * 60 * 1000;
const MAX_MS = 12 * 60 * 60 * 1000;
const LOCK_AFTER = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  sessionId: string;
  roles: { entityId: string; role: Role }[];
  /** Organisation (client) de l'utilisateur ; null = administrateur de la plateforme. */
  organizationId: string | null;
  isPlatformAdmin: boolean;
  stepUpUntil: Date | null;
  totpEnabled: boolean;
  /** 2FA obligatoire pour ses rôles mais pas encore activée. */
  needsTotpSetup: boolean;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });
export const verifyPassword = (hash: string, password: string) =>
  argon2.verify(hash, password).catch(() => false);

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export function requestMeta(request: Request): RequestMeta {
  const fwd = request.headers.get('x-forwarded-for');
  return {
    ip: fwd?.split(',')[0]?.trim() || null,
    userAgent: request.headers.get('user-agent'),
  };
}

/** Vérifie les identifiants, applique le verrouillage, crée la session. Retourne le token brut. */
export async function login(
  email: string,
  password: string,
  totpCode: string | undefined,
  meta: RequestMeta,
): Promise<string> {
  const since = new Date(Date.now() - LOCK_WINDOW_MS);
  const sys = systemDb(); // authentification : aucune donnée métier, aucune organisation
  const lastOk = await sys.loginEvent.findFirst({
    where: { email, success: true, at: { gte: since } },
    orderBy: { at: 'desc' },
    select: { at: true },
  });
  const failures = await sys.loginEvent.count({
    where: { email, success: false, at: { gte: lastOk?.at ?? since } },
  });
  if (failures >= LOCK_AFTER) {
    throw new AppError('ACCOUNT_LOCKED', 429, 'Trop de tentatives. Réessayez dans 15 minutes.');
  }

  const user = await sys.user.findUnique({ where: { email } });
  // Même coût de calcul si l'utilisateur n'existe pas (pas d'énumération par le temps de réponse).
  let ok = user?.isActive ? await verifyPassword(user.passwordHash, password) : false;

  if (ok && !twoFactorDisabled() && user?.totpEnabledAt && user.totpSecretEnc) {
    // Mot de passe correct : on demande le code sans comptabiliser d'échec.
    if (!totpCode) throw new AppError('TOTP_REQUIRED', 401, 'Code de vérification requis');
    ok = verifyCode(decrypt(user.totpSecretEnc), totpCode);
  }

  await sys.loginEvent.create({
    data: { userId: user?.id ?? null, email, success: ok, ip: meta.ip, userAgent: meta.userAgent },
  });
  if (!user || !ok) throw new AppError('INVALID_CREDENTIALS', 401, 'E-mail ou mot de passe incorrect');

  const token = randomBytes(32).toString('hex');
  const now = new Date();
  await sys.session.create({
    data: {
      id: hashToken(token),
      userId: user.id,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + MAX_MS),
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
  });
  // L'audit appartient à l'organisation de l'utilisateur (ou à la plateforme s'il n'en a pas).
  await runInOrg(user.organizationId, () =>
    prisma.$transaction((tx) =>
      writeAudit(tx, { actorId: user.id, action: 'auth.login', entityType: 'User', entityId: user.id, ip: meta.ip }),
    ),
  );
  return token;
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_MS / 1000,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Résout l'utilisateur courant depuis le cookie ; applique expirations et glissement d'inactivité. */
export const getCurrentUser = cache(async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const id = hashToken(token);
  const sys = systemDb();
  const session = await sys.session.findUnique({
    where: { id },
    include: { user: { include: { roles: true } } },
  });
  if (!session) return null;

  const now = Date.now();
  const expired = session.expiresAt.getTime() <= now || now - session.lastSeenAt.getTime() > IDLE_MS;
  if (expired || !session.user.isActive) {
    await sys.session.delete({ where: { id } }).catch(() => undefined);
    return null;
  }
  // Évite une écriture à chaque requête : rafraîchit au plus une fois par minute.
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await sys.session.update({ where: { id }, data: { lastSeenAt: new Date(now) } });
  }

  const { user } = session;
  const roles = user.roles.map((r) => ({ entityId: r.entityId, role: r.role }));
  const totpEnabled = Boolean(user.totpEnabledAt);
  // Une organisation désactivée par la plateforme n'a plus accès à rien.
  if (user.organizationId) {
    const org = await sys.organization.findUnique({ where: { id: user.organizationId }, select: { isActive: true } });
    if (!org?.isActive) return null;
  }
  // Tout le rendu serveur de cette requête sera isolé sur l'organisation de l'utilisateur (RLS).
  bindRscTenant(user.organizationId);
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    sessionId: id,
    roles,
    organizationId: user.organizationId,
    isPlatformAdmin: user.isPlatformAdmin,
    stepUpUntil: session.stepUpUntil,
    totpEnabled,
    needsTotpSetup: !twoFactorDisabled() && isTotpRequired(roles) && !totpEnabled,
  };
});

export async function logout(user: CurrentUser, meta: RequestMeta) {
  await systemDb().session.deleteMany({ where: { id: user.sessionId } });
  await runInOrg(user.organizationId, () =>
    prisma.$transaction((tx) =>
      writeAudit(tx, { actorId: user.id, action: 'auth.logout', entityType: 'User', entityId: user.id, ip: meta.ip }),
    ),
  );
  await clearSessionCookie();
}

export interface SessionInfo {
  id: string;
  ip: string | null;
  userAgent: string | null;
  lastSeenAt: Date;
  current: boolean;
}

/** Sessions actives de l'utilisateur. L'id exposé est un préfixe du hash (suffisant pour révoquer, inutilisable comme token). */
export async function listSessions(user: CurrentUser): Promise<SessionInfo[]> {
  const rows = await systemDb().session.findMany({
    where: { userId: user.id, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id.slice(0, 16),
    ip: r.ip,
    userAgent: r.userAgent,
    lastSeenAt: r.lastSeenAt,
    current: r.id === user.sessionId,
  }));
}

export async function revokeSession(user: CurrentUser, shortId: string, meta: RequestMeta) {
  if (!/^[0-9a-f]{16}$/.test(shortId)) throw new AppError('NOT_FOUND', 404, 'Session introuvable');
  const { count } = await systemDb().session.deleteMany({
    where: { userId: user.id, id: { startsWith: shortId } },
  });
  if (count === 0) throw new AppError('NOT_FOUND', 404, 'Session introuvable');
  await prisma.$transaction((tx) =>
    writeAudit(tx, { actorId: user.id, action: 'auth.session.revoke', entityType: 'User', entityId: user.id, ip: meta.ip }),
  );
}
