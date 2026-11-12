import 'server-only';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export interface AuditInput {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string | null;
}

/** À appeler avec le client de transaction pour que l'audit soit atomique avec l'action. */
export async function writeAudit(db: Db, input: AuditInput): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before,
      after: input.after,
      ip: input.ip ?? null,
    },
  });
}
