import 'server-only';
import type { Currency } from '@/generated/prisma/enums';
import { localDay, localDayEnd } from '@/lib/dates';
import type { CurrentUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { D, ZERO, sum, toMoneyString } from '@/server/money';
import { accessibleEntityIds, assertCan } from '@/server/permissions';
import { listAdvances, openAdvanceTotals } from '../advances/service';
import { budgetExecution } from '../budgets/service';
import { periodTotals } from '../reports/totals';
import { unusualOperations } from '../reports/unusual';

export interface DashboardAlert { level: 'warning' | 'danger'; text: string; href?: string }

const startOfMonth = (day: Date, monthsBack = 0) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - monthsBack, 1) - 2 * 3600_000);
const endOfMonth = (day: Date, monthsBack = 0) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - monthsBack + 1, 1) - 2 * 3600_000 - 1);

async function balanceByCurrency(entityId: string, type: 'CASH' | 'BANK') {
  const accs = await prisma.account.findMany({ where: { entityId, type, isActive: true }, select: { id: true, currency: true } });
  const sums = await prisma.ledgerEntry.groupBy({ by: ['accountId'], where: { accountId: { in: accs.map((a) => a.id) } }, _sum: { amount: true } });
  const bal = new Map(sums.map((s) => [s.accountId, s._sum.amount ? D(s._sum.amount) : ZERO]));
  return (['USD', 'CDF'] as const).map((currency) => ({
    currency,
    total: toMoneyString(sum(accs.filter((a) => a.currency === currency).map((a) => bal.get(a.id) ?? ZERO))),
    count: accs.filter((a) => a.currency === currency).length,
  }));
}

/** Tableau de bord d'UNE entité. La vue consolidée appelle cette fonction pour chaque entité : jamais de fusion. */
export async function entityDashboard(actor: CurrentUser, entityId: string, now = new Date()) {
  assertCan(actor, 'account.read', entityId);
  const entity = await prisma.entity.findUniqueOrThrow({ where: { id: entityId } });
  const today = localDay(now);
  const from = startOfMonth(today);
  const to = localDayEnd(today);

  const [period, cash, bank] = await Promise.all([periodTotals(entityId, from, to), balanceByCurrency(entityId, 'CASH'), balanceByCurrency(entityId, 'BANK')]);

  // Évolution sur 4 mois (recettes / dépenses par devise).
  const series = [];
  for (let m = 3; m >= 0; m--) {
    const f = startOfMonth(today, m);
    const t = await periodTotals(entityId, f, endOfMonth(today, m));
    series.push({ month: f.toISOString().slice(0, 7), totals: t });
  }

  const [statusCounts, pendingWithdrawals] = await Promise.all([
    prisma.fundRequest.groupBy({ by: ['status'], where: { entityId, status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED', 'APPROVED', 'DISBURSED', 'RECEIVED', 'JUSTIFIED'] } }, _count: true }),
    prisma.pendingTransfer.count({ where: { entityId, status: 'IN_TRANSIT' } }),
  ]);

  const bankAccounts = await prisma.account.findMany({ where: { entityId, type: 'BANK' }, select: { id: true, name: true } });
  const recentBank = await prisma.ledgerEntry.findMany({
    where: { accountId: { in: bankAccounts.map((a) => a.id) }, tx: { status: 'POSTED' } },
    include: { tx: { select: { reference: true, date: true, description: true, kind: true } } },
    orderBy: { tx: { date: 'desc' } }, take: 6,
  });

  const cashAccounts = await prisma.account.findMany({ where: { entityId, type: 'CASH' }, select: { id: true, name: true } });
  const cashPending = await prisma.cashSession.count({ where: { accountId: { in: cashAccounts.map((a) => a.id) }, status: 'PENDING_VALIDATION' } });
  const reconPending = await prisma.bankStatement.count({ where: { entityId, status: { in: ['IN_PROGRESS', 'SUBMITTED'] } } });
  const advTotals = await openAdvanceTotals(actor, entityId).catch(() => null);

  // --- Alertes ---------------------------------------------------------------
  const alerts: DashboardAlert[] = [];
  const budgets = await prisma.budget.findMany({ where: { entityId, periodStart: { lte: now }, periodEnd: { gte: now } } });
  for (const b of budgets) {
    for (const l of (await budgetExecution(actor, b.id).catch(() => null))?.lines ?? []) {
      if (l.alert === 'OVER_100') alerts.push({ level: 'danger', text: `Budget « ${b.name} » (${l.label || 'ensemble'}) dépassé : ${l.percentConsumed} %`, href: `/budgets/${b.id}` });
      else if (l.alert === 'WARN_80') alerts.push({ level: 'warning', text: `Budget « ${b.name} » (${l.label || 'ensemble'}) à ${l.percentConsumed} %`, href: `/budgets/${b.id}` });
    }
  }
  const oldAdv = (await listAdvances(actor, { entityId }).catch(() => [])).filter((a) => a.overdue);
  for (const a of oldAdv) alerts.push({ level: 'warning', text: `Avance ${a.reference} ouverte depuis ${a.ageDays} jours`, href: `/avances/${a.id}` });

  // Caisses non clôturées : jours passés (7 derniers) avec mouvements mais sans clôture.
  const weekAgo = new Date(today.getTime() - 7 * 86_400_000 - 2 * 3600_000);
  for (const acc of cashAccounts) {
    const moves = await prisma.ledgerEntry.findMany({ where: { accountId: acc.id, tx: { status: 'POSTED', kind: { not: 'OPENING_BALANCE' }, date: { gte: weekAgo, lt: new Date(today.getTime() - 2 * 3600_000) } } }, select: { tx: { select: { date: true } } } });
    const days = new Set(moves.map((m) => localDay(m.tx.date).getTime()));
    const closed = new Set((await prisma.cashSession.findMany({ where: { accountId: acc.id, date: { gte: localDay(weekAgo) } }, select: { date: true } })).map((s) => s.date.getTime()));
    const open = [...days].filter((d) => !closed.has(d));
    if (open.length) alerts.push({ level: 'warning', text: `${acc.name} : ${open.length} jour(s) sans clôture`, href: `/caisses/${acc.id}` });
  }
  if (cashPending) alerts.push({ level: 'warning', text: `${cashPending} écart(s) de caisse à valider` });
  const unusual = await unusualOperations(entityId, new Date(to.getTime() - 30 * 86_400_000), to);
  const dups = unusual.filter((u) => u.reason.startsWith('Doublon'));
  if (dups.length) alerts.push({ level: 'danger', text: `${dups.length} doublon(s) potentiel(s) de dépenses sur 30 jours` });
  if (unusual.length - dups.length > 0) alerts.push({ level: 'warning', text: `${unusual.length - dups.length} dépense(s) inhabituellement élevée(s) sur 30 jours` });

  return {
    entity: { id: entity.id, code: entity.code, name: entity.name },
    period: { from, to }, totals: period, cash, bank, series,
    requests: statusCounts.map((s) => ({ status: s.status, count: s._count })), pendingWithdrawals,
    recentBank: recentBank.map((e) => ({ date: e.tx.date, reference: e.tx.reference, description: e.tx.description, amount: toMoneyString(D(e.amount)), currency: e.currency as Currency })),
    advances: advTotals, cashDifferencesPending: cashPending, reconciliationsPending: reconPending, alerts,
  };
}

/** Une entrée par entité visible ET autorisée : la consolidation reste côte à côte. */
export async function dashboard(actor: CurrentUser, entityIds: string[]) {
  const allowed = accessibleEntityIds(actor).filter((id) => entityIds.includes(id));
  const out = [];
  for (const id of allowed) {
    try { out.push(await entityDashboard(actor, id)); } catch { /* pas de droit de lecture sur cette entité : ignorée */ }
  }
  return out;
}
export type EntityDashboard = Awaited<ReturnType<typeof entityDashboard>>;
