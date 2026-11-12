import 'server-only';
import type { CurrentUser } from '@/server/auth';
import { prisma } from '@/server/db';

export async function listNotifications(user: CurrentUser) {
  const [unread, items] = await Promise.all([
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  return { unread, data: items };
}

export const countUnread = (user: CurrentUser) => prisma.notification.count({ where: { userId: user.id, readAt: null } });

export async function markAllRead(user: CurrentUser) {
  await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
}
