import 'server-only';
import type { Currency } from '@/generated/prisma/enums';
import type { CreateRateInput } from '@/lib/schemas/accounts';
import { writeAudit } from '@/server/audit';
import type { CurrentUser, RequestMeta } from '@/server/auth';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { assertCan } from '@/server/permissions';

const rateView = (r: { id: string; date: Date; base: Currency; quote: Currency; rate: { toString(): string }; source: string }) => ({
  id: r.id, date: r.date, base: r.base, quote: r.quote, rate: r.rate.toString(), source: r.source,
});

/** Les taux sont globaux : il suffit que l'utilisateur détienne fx.manage dans une de ses entités. */
function assertFxManager(user: CurrentUser) {
  const entityId = user.roles.find((r) => r.role === 'CONTROLLER')?.entityId;
  if (!entityId) throw new AppError('FORBIDDEN', 403, 'Réservé à la contrôleuse financière');
  assertCan(user, 'fx.manage', entityId);
}

export async function createRate(actor: CurrentUser, input: CreateRateInput, meta: RequestMeta) {
  assertFxManager(actor);
  if (input.base === input.quote) throw new AppError('VALIDATION_ERROR', 400, 'Devises identiques');
  const date = new Date(input.date);
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.exchangeRate.create({
        data: { date, base: input.base, quote: input.quote, rate: input.rate, source: input.source, createdById: actor.id },
      });
      await writeAudit(tx, {
        actorId: actor.id, action: 'fx.rate.create', entityType: 'ExchangeRate', entityId: row.id,
        after: { base: row.base, quote: row.quote, rate: row.rate.toString(), source: row.source, date: date.toISOString() }, ip: meta.ip,
      });
      return rateView(row);
    });
  } catch (e) {
    if (typeof e === 'object' && e && 'code' in e && e.code === 'P2002') {
      throw new AppError('RATE_EXISTS', 409, 'Un taux existe déjà pour cette date, cette paire et cette source');
    }
    throw e;
  }
}

export async function listRates(user: CurrentUser) {
  if (user.roles.length === 0) throw new AppError('FORBIDDEN', 403, 'Accès refusé');
  const rows = await prisma.exchangeRate.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 200 });
  return rows.map(rateView);
}

/** Dernier taux connu pour la paire (proposé dans les formulaires de conversion, modifiable). */
export async function latestRate(user: CurrentUser, base: Currency, quote: Currency) {
  if (user.roles.length === 0) throw new AppError('FORBIDDEN', 403, 'Accès refusé');
  const row = await prisma.exchangeRate.findFirst({
    where: { base, quote },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  if (!row) throw new AppError('NOT_FOUND', 404, 'Aucun taux enregistré pour cette paire');
  return rateView(row);
}
