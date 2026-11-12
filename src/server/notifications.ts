import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import type { Role } from '@/generated/prisma/enums';

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
}

/** Notifie les utilisateurs actifs ayant l'un des rôles donnés dans l'entité. */
export async function notifyRole(db: Db, entityId: string, roles: Role[], input: NotifyInput, exceptUserId?: string) {
  const rows = await db.userEntityRole.findMany({
    where: { entityId, role: { in: roles }, user: { isActive: true } },
    select: { userId: true },
  });
  await notifyUsers(db, rows.map((r) => r.userId).filter((id) => id !== exceptUserId), input);
}
