import 'server-only';
import { Prisma } from '@/generated/prisma/client';
import type { Currency } from '@/generated/prisma/enums';
import type { CreateBudgetInput } from '@/lib/schemas/budgets';
import { writeAudit } from '@/server/audit';
import type { CurrentUser, RequestMeta } from '@/server/auth';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { D, ZERO, sum, toMoneyString, type Money } from '@/server/money';
import { accessibleEntityIds, assertCan, assertEntityAccess, readableEntityIds } from '@/server/permissions';

type Db = Prisma.TransactionClient | typeof prisma;

export async function createBudget(actor: CurrentUser, input: CreateBudgetInput, meta: RequestMeta) {
  assertEntityAccess(actor, input.entityId);
  assertCan(actor, 'budget.manage', input.entityId);
  const start = new Date(input.periodStart);
  const end = new Date(input.periodEnd);
  if (end <= start) throw new AppError('VALIDATION_ERROR', 400, 'La fin de période doit suivre le début');

  return prisma.$transaction(async (tx) => {
    const deps = await tx.department.findMany({ where: { entityId: input.entityId }, select: { id: true } });
    const cats = await tx.category.findMany({ where: { entityId: input.entityId, kind: 'EXPENSE' }, select: { id: true } });
    for (const l of input.lines) {
      if (l.departmentId && !deps.some((d) => d.id === l.departmentId)) throw new AppError('VALIDATION_ERROR', 400, 'Département inconnu');
      if (l.categoryId && !cats.some((c) => c.id === l.categoryId)) throw new AppError('VALIDATION_ERROR', 400, 'Catégorie de dépense inconnue');
    }
    const budget = await tx.budget.create({
      data: {
        entityId: input.entityId, name: input.name, periodStart: start, periodEnd: end, currency: input.currency,
        createdById: actor.id,
        lines: { create: input.lines.map((l) => ({ departmentId: l.departmentId, categoryId: l.categoryId, amount: l.amount })) },
      },
      include: { lines: true },
    });
    await writeAudit(tx, {
      actorId: actor.id, action: 'budget.create', entityType: 'Budget', entityId: budget.id,
      after: { name: budget.name, currency: budget.currency, lines: budget.lines.length }, ip: meta.ip,
    });
    return { id: budget.id };
  });
}

export async function listBudgets(actor: CurrentUser, entityId?: string) {
  const ids = readableEntityIds(actor, 'account.read').filter((id) => !entityId || id === entityId);
  const rows = await prisma.budget.findMany({
    where: { entityId: { in: ids } }, orderBy: { periodStart: 'desc' }, include: { lines: true },
  });
  return rows.map((b) => ({
    id: b.id, entityId: b.entityId, name: b.name, periodStart: b.periodStart, periodEnd: b.periodEnd, currency: b.currency,
    total: toMoneyString(sum(b.lines.map((l) => D(l.amount)))), lines: b.lines.length,
  }));
}

interface LineSpec { departmentId: string | null; categoryId: string | null }

/** Réalisé : dépenses non contre-passées de la période (par devise), filtrées sur département et/ou catégorie. */
async function realised(db: Db, p: { entityId: string; currency: Currency; from: Date; to: Date } & LineSpec): Promise<Money> {
  const dep = p.departmentId ? Prisma.sql`AND x."departmentId" = ${p.departmentId}` : Prisma.empty;
  const cat = p.categoryId ? Prisma.sql`AND x."categoryId" = ${p.categoryId}` : Prisma.empty;
  const rows = await db.$queryRaw<{ total: string }[]>(Prisma.sql`
    SELECT COALESCE(SUM(x."amount"), 0)::text AS total
    FROM "Expense" x JOIN "FinancialTransaction" t ON t."expenseId" = x."id"
    WHERE t."status" = 'POSTED' AND x."entityId" = ${p.entityId} AND x."currency" = ${p.currency}::"Currency"
      AND x."date" >= ${p.from} AND x."date" <= ${p.to} ${dep} ${cat}`);
  return D(rows[0]?.total ?? '0');
}

/**
 * Engagé : demandes APPROVED pas encore décaissées. Les demandes n'ont pas de catégorie : une ligne
 * « catégorie seule » ne reçoit donc pas d'engagement (limite assumée, documentée dans l'écran).
 */
async function committed(db: Db, p: { entityId: string; currency: Currency } & LineSpec): Promise<Money> {
  if (!p.departmentId) return ZERO;
  const agg = await db.fundRequest.aggregate({
    where: { entityId: p.entityId, currency: p.currency, status: 'APPROVED', departmentId: p.departmentId },
    _sum: { amount: true },
  });
  return agg._sum.amount ? D(agg._sum.amount) : ZERO;
}

export type BudgetAlert = 'OK' | 'WARN_80' | 'OVER_100';
const alertFor = (pct: number): BudgetAlert => (pct >= 100 ? 'OVER_100' : pct >= 80 ? 'WARN_80' : 'OK');

export async function budgetExecution(actor: CurrentUser, budgetId: string) {
  const budget = await prisma.budget.findUnique({ where: { id: budgetId }, include: { lines: true } });
  if (!budget || !accessibleEntityIds(actor).includes(budget.entityId)) throw new AppError('NOT_FOUND', 404, 'Budget introuvable');
  assertCan(actor, 'account.read', budget.entityId);
  const [deps, cats] = await Promise.all([
    prisma.department.findMany({ where: { entityId: budget.entityId } }),
    prisma.category.findMany({ where: { entityId: budget.entityId } }),
  ]);
  const lines = await Promise.all(
    budget.lines.map(async (l) => {
      const spec = { departmentId: l.departmentId, categoryId: l.categoryId };
      const [spent, engaged] = await Promise.all([
        realised(prisma, { entityId: budget.entityId, currency: budget.currency, from: budget.periodStart, to: budget.periodEnd, ...spec }),
        committed(prisma, { entityId: budget.entityId, currency: budget.currency, ...spec }),
      ]);
      const amount = D(l.amount);
      const available = amount.minus(engaged).minus(spent);
      const pct = amount.isZero() ? 0 : engaged.plus(spent).div(amount).times(100).toDecimalPlaces(1).toNumber();
      return {
        id: l.id,
        label: [l.departmentId && deps.find((d) => d.id === l.departmentId)?.name, l.categoryId && cats.find((c) => c.id === l.categoryId)?.name]
          .filter(Boolean).join(' · '),
        budget: toMoneyString(amount), committed: toMoneyString(engaged), realised: toMoneyString(spent),
        available: toMoneyString(available), percentConsumed: pct, alert: alertFor(pct),
      };
    }),
  );
  return {
    id: budget.id, name: budget.name, entityId: budget.entityId, currency: budget.currency,
    periodStart: budget.periodStart, periodEnd: budget.periodEnd, lines,
  };
}

/** Avertissements NON bloquants à l'approbation : la demande ferait dépasser une ligne de budget de son département. */
export async function budgetWarningsForRequest(
  tx: Prisma.TransactionClient,
  req: { entityId: string; currency: Currency; amount: Prisma.Decimal; departmentId: string | null; id: string },
): Promise<string[]> {
  if (!req.departmentId) return [];
  const now = new Date();
  const budgets = await tx.budget.findMany({
    where: { entityId: req.entityId, currency: req.currency, periodStart: { lte: now }, periodEnd: { gte: now } },
    include: { lines: { where: { departmentId: req.departmentId } } },
  });
  const warnings: string[] = [];
  for (const b of budgets) {
    for (const l of b.lines) {
      const spec = { departmentId: l.departmentId, categoryId: l.categoryId };
      const spent = await realised(tx, { entityId: req.entityId, currency: req.currency, from: b.periodStart, to: b.periodEnd, ...spec });
      const engaged = await committed(tx, { entityId: req.entityId, currency: req.currency, ...spec });
      const total = spent.plus(engaged).plus(D(req.amount));
      if (total.greaterThan(D(l.amount))) {
        warnings.push(`Budget « ${b.name} » dépassé de ${toMoneyString(total.minus(D(l.amount)))} ${req.currency}`);
      }
    }
  }
  return warnings;
}

/**
 * Prévision de trésorerie simple, par devise : soldes actuels − engagements + recettes hebdomadaires moyennes
 * des N dernières semaines (projection à une semaine).
 */
export async function treasuryForecast(actor: CurrentUser, entityId: string, weeks = 4) {
  assertEntityAccess(actor, entityId);
  assertCan(actor, 'account.read', entityId);
  const n = Math.min(Math.max(Math.floor(weeks), 1), 52);
  const since = new Date(Date.now() - n * 7 * 86_400_000);
  const out = [];
  for (const currency of ['USD', 'CDF'] as const) {
    const [bal, eng, inc] = await Promise.all([
      prisma.ledgerEntry.aggregate({ where: { currency, account: { entityId } }, _sum: { amount: true } }),
      prisma.fundRequest.aggregate({ where: { entityId, currency, status: 'APPROVED' }, _sum: { amount: true } }),
      prisma.$queryRaw<{ total: string }[]>`
        SELECT COALESCE(SUM(e."amount"), 0)::text AS total
        FROM "LedgerEntry" e JOIN "FinancialTransaction" t ON t."id" = e."txId"
        WHERE t."entityId" = ${entityId} AND t."kind" = 'INCOME' AND t."status" = 'POSTED'
          AND e."currency" = ${currency}::"Currency" AND t."date" >= ${since}`,
    ]);
    const balance = bal._sum.amount ? D(bal._sum.amount) : ZERO;
    const engaged = eng._sum.amount ? D(eng._sum.amount) : ZERO;
    const avgWeeklyIncome = D(inc[0]?.total ?? '0').div(n).toDecimalPlaces(2);
    out.push({
      currency, weeks: n, balance: toMoneyString(balance), committed: toMoneyString(engaged),
      avgWeeklyIncome: toMoneyString(avgWeeklyIncome),
      projected: toMoneyString(balance.minus(engaged).plus(avgWeeklyIncome)),
    });
  }
  return out;
}
