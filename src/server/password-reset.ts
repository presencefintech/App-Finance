import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { writeAudit } from '@/server/audit';
import { hashPassword, type RequestMeta } from '@/server/auth';
import { prisma, systemDb } from '@/server/db';
import { sendEmail } from '@/server/email';
import { AppError } from '@/server/errors';
import { runInOrg } from '@/server/tenant';

const TTL_MS = 60 * 60 * 1000;
const MAX_PER_HOUR = 3;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * « Mot de passe oublié » : envoie un lien à usage unique (1 h) si le compte existe et est actif.
 * La réponse est identique dans tous les cas : on ne révèle jamais si une adresse est enregistrée.
 * Au plus 3 demandes par heure et par compte.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const sys = systemDb();
  const user = await sys.user.findUnique({ where: { email }, select: { id: true, email: true, isActive: true } });
  if (!user?.isActive) return;
  const recent = await sys.passwordResetToken.count({ where: { userId: user.id, createdAt: { gte: new Date(Date.now() - TTL_MS) } } });
  if (recent >= MAX_PER_HOUR) return;

  const token = randomBytes(32).toString('hex');
  await sys.passwordResetToken.create({ data: { id: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + TTL_MS) } });
  const base = process.env.APP_URL?.split(/[\s,;]+/).filter(Boolean).at(-1)?.replace(/\/$/, '') ?? '';
  sendEmail({
    to: user.email,
    subject: 'Fintrax — Réinitialisation de votre mot de passe',
    text:
      `Une réinitialisation de mot de passe a été demandée pour votre compte.\n\n` +
      `Ouvrez ce lien (valable 1 heure, à usage unique) :\n${base}/reinitialiser-mot-de-passe?token=${token}\n\n` +
      `Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.`,
  });
}

/** Définit le nouveau mot de passe avec le jeton, déconnecte tous les appareils et consomme le jeton. */
export async function resetPassword(token: string, newPassword: string, meta: RequestMeta): Promise<void> {
  const sys = systemDb();
  const row = await sys.passwordResetToken.findUnique({ where: { id: sha256(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt < new Date() || !row.user.isActive) {
    throw new AppError('INVALID_TOKEN', 400, 'Lien invalide ou expiré. Refaites une demande de réinitialisation.');
  }
  const passwordHash = await hashPassword(newPassword);
  // Consommation atomique : un même jeton ne peut servir qu'une fois, même en cas de requêtes simultanées.
  const consumed = await sys.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (consumed.count === 0) throw new AppError('INVALID_TOKEN', 400, 'Lien invalide ou expiré. Refaites une demande de réinitialisation.');
  await sys.user.update({ where: { id: row.userId }, data: { passwordHash } });
  await sys.session.deleteMany({ where: { userId: row.userId } });
  await sys.passwordResetToken.deleteMany({ where: { userId: row.userId, id: { not: row.id } } });
  await runInOrg(row.user.organizationId, () =>
    prisma.$transaction((tx) =>
      writeAudit(tx, { actorId: row.userId, action: 'auth.password.reset', entityType: 'User', entityId: row.userId, ip: meta.ip }),
    ),
  );
}
