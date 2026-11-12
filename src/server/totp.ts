import 'server-only';
import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import { decrypt, encrypt } from './crypto';
import { prisma } from './db';
import { writeAudit } from './audit';
import { AppError } from './errors';
import type { CurrentUser, RequestMeta } from './auth';
import { twoFactorDisabled } from '@/lib/totp-policy';

const ISSUER = 'SEC Finance Control';
const STEP_UP_MS = 5 * 60 * 1000;

export function verifyCode(secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  // Tolérance d'une période (30 s) de chaque côté pour le décalage d'horloge.
  return verifySync({ secret, token: code, epochTolerance: 30 }).valid;
}

/** Démarre l'enrôlement : génère un secret (stocké chiffré, non activé) et renvoie l'URI + QR. */
export async function beginTotpSetup(user: CurrentUser) {
  const existing = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (existing.totpEnabledAt) throw new AppError('TOTP_ALREADY_ENABLED', 409, 'La 2FA est déjà activée');
  const secret = generateSecret();
  await prisma.user.update({ where: { id: user.id }, data: { totpSecretEnc: encrypt(secret) } });
  const uri = generateURI({ issuer: ISSUER, label: user.email, secret });
  return { secret, uri, qrDataUrl: await QRCode.toDataURL(uri) };
}

/** Confirme l'enrôlement avec un premier code valide. */
export async function confirmTotpSetup(user: CurrentUser, code: string, meta: RequestMeta) {
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!row.totpSecretEnc) throw new AppError('TOTP_NOT_STARTED', 409, "Démarrez d'abord l'enrôlement");
  if (!verifyCode(decrypt(row.totpSecretEnc), code)) {
    throw new AppError('INVALID_TOTP', 400, 'Code incorrect');
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date() } });
    await writeAudit(tx, { actorId: user.id, action: 'auth.totp.enable', entityType: 'User', entityId: user.id, ip: meta.ip });
  });
}

/** Step-up : une 2FA récente (5 min) est exigée pour les opérations sensibles. */
export async function stepUp(user: CurrentUser, code: string, meta: RequestMeta) {
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!row.totpSecretEnc || !row.totpEnabledAt) {
    throw new AppError('TOTP_NOT_ENABLED', 409, "La 2FA n'est pas activée");
  }
  if (!verifyCode(decrypt(row.totpSecretEnc), code)) {
    throw new AppError('INVALID_TOTP', 400, 'Code incorrect');
  }
  const until = new Date(Date.now() + STEP_UP_MS);
  await prisma.$transaction(async (tx) => {
    await tx.session.update({ where: { id: user.sessionId }, data: { stepUpUntil: until } });
    await writeAudit(tx, { actorId: user.id, action: 'auth.step-up', entityType: 'User', entityId: user.id, ip: meta.ip });
  });
  return until;
}

/** À appeler dans les services avant une opération sensible. Le client répond en ouvrant <StepUpDialog>. */
export function requireStepUp(user: CurrentUser): void {
  if (twoFactorDisabled()) return; // 2FA désactivée par réglage d'environnement (démo / recette)
  if (!user.stepUpUntil || user.stepUpUntil.getTime() <= Date.now()) {
    throw new AppError('STEP_UP_REQUIRED', 403, 'Confirmation par code 2FA requise');
  }
}
