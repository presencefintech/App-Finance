import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import type { Role } from '@/generated/prisma/enums';
import { emailEnabled, queueEmail } from '@/server/email';

type Db = Prisma.TransactionClient;

export interface NotifyInput {
  title: string;
  body: string;
  href?: string;
}

export async function notifyUsers(db: Db, userIds: string[], input: NotifyInput): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  await db.notification.createMany({ data: unique.map((userId) => ({ userId, ...input })) });

  // Copie par e-mail (si Resend est configuré) : mise en file, envoyée seulement si la transaction aboutit.
  if (!emailEnabled()) return;
  const users = await db.user.findMany({ where: { id: { in: unique }, isActive: true }, select: { email: true } });
  const base = process.env.APP_URL?.split(/[\s,;]+/).filter(Boolean).at(-1)?.replace(/\/$/, '') ?? '';
  const link = input.href ? `\n\nOuvrir : ${base}${input.href}` : '';
  for (const u of users) {
    queueEmail({ to: u.email, subject: `Finance Control — ${input.title}`, text: `${input.title}\n\n${input.body}${link}` });
  }
}

/** Notifie les utilisateurs actifs ayant l'un des rôles donnés dans l'entité. */
export async function notifyRole(db: Db, entityId: string, roles: Role[], input: NotifyInput, exceptUserId?: string) {
  const rows = await db.userEntityRole.findMany({
    where: { entityId, role: { in: roles }, user: { isActive: true } },
    select: { userId: true },
  });
  await notifyUsers(db, rows.map((r) => r.userId).filter((id) => id !== exceptUserId), input);
}
