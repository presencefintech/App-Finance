import 'server-only';
import type { Currency } from '@/generated/prisma/enums';
import { localDay } from '@/lib/dates';
import type { CurrentUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { D, ZERO, toMoneyString, type Money } from '@/server/money';
import { accessibleEntityIds, assertCan } from '@/server/permissions';
import { periodTotals } from '../reports/totals';

const DAY = 86_400_000;
const OFFSET = 2 * 3600_000;
const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const startOfMonth = (day: Date, back = 0) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - back, 1) - OFFSET);
const endOfMonth = (day: Date, back = 0) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - back + 1, 1) - OFFSET - 1);
export const monthLabel = (d: Date) => MONTHS_FR[new Date(d.getTime() + OFFSET).getUTCMonth()]!;

/** Solde de fin de journée d'un compte sur N jours (dérivé du grand livre, jamais stocké). */
export async function balanceHistory(actor: CurrentUser, accountId: string, days = 30) {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account || !accessibleEntityIds(actor).includes(account.entityId)) throw new AppError('NOT_FOUND', 404, 'Compte introuvable');
  assertCan(actor, 'account.read', account.entityId);
  const today = localDay(new Date());
  const start = new Date(today.getTime() - (days - 1) * DAY - OFFSET);
  const before = await prisma.ledgerEntry.aggregate({ where: { accountId, tx: { date: { lt: start } } }, _sum: { amount: true } });
  const entries = await prisma.ledgerEntry.findMany({ where: { accountId, tx: { date: { gte: start } } }, select: { amount: true, tx: { select: { date: true } } } });
  const byDay = new Map<number, Money>();
  for (const e of entries) {
    const k = localDay(e.tx.date).getTime();
    byDay.set(k, (byDay.get(k) ?? ZERO).plus(D(e.amount)));
  }
  let running = before._sum.amount ? D(before._sum.amount) : ZERO;
  const points: { date: Date; balance: number }[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(today.getTime() - (days - 1 - i) * DAY);
    running = running.plus(byDay.get(day.getTime()) ?? ZERO);
    points.push({ date: day, balance: Number(running.toFixed(2)) });
  }
  return { currency: account.currency as Currency, points };
}

/** Répartition par catégorie (recettes ou dépenses réelles), par devise, hors opérations contre-passées. */
export async function categoryBreakdown(actor: CurrentUser, entityId: string, kind: 'INCOME' | 'EXPENSE', from: Date, to: Date) {
  if (!accessibleEntityIds(actor).includes(entityId)) throw new AppError('FORBIDDEN', 403, 'Entité inaccessible');
  assertCan(actor, 'account.read', entityId);
  const cats = new Map((await prisma.category.findMany({ where: { entityId } })).map((c) => [c.id, c.name]));
  const rows = kind === 'INCOME'
    ? await prisma.income.findMany({ where: { entityId, date: { gte: from, lte: to } }, select: { reference: true, categoryId: true, amount: true, currency: true } })
    : await prisma.expense.findMany({ where: { entityId, date: { gte: from, lte: to } }, select: { reference: true, categoryId: true, amount: true, currency: true } });
  const live = new Set((await prisma.financialTransaction.findMany({ where: { reference: { in: rows.map((r) => r.reference) }, status: 'POSTED' }, select: { reference: true } })).map((t) => t.reference));
  const acc = new Map<string, Money>();
  for (const r of rows) {
    if (!live.has(r.reference)) continue;
    const k = `${r.currency}|${cats.get(r.categoryId) ?? 'Sans catégorie'}`;
    acc.set(k, (acc.get(k) ?? ZERO).plus(D(r.amount)));
  }
  const out: Record<Currency, { name: string; value: number }[]> = { USD: [], CDF: [] };
  for (const [k, v] of acc) {
    const [cur, name] = k.split('|') as [Currency, string];
    out[cur].push({ name, value: Number(v.toFixed(2)) });
  }
  return out;
}

/** Répartition sur les N derniers jours (la date « maintenant » est calculée côté serveur, pas dans un composant). */
export const recentBreakdown = (actor: CurrentUser, entityId: string, kind: 'INCOME' | 'EXPENSE', days: number) =>
  categoryBreakdown(actor, entityId, kind, new Date(Date.now() - days * DAY), new Date());

/** Recettes / dépenses mensuelles sur N mois, par devise (transferts, avances et ouvertures exclus). */
export async function monthlySeries(actor: CurrentUser, entityId: string, months = 6) {
  if (!accessibleEntityIds(actor).includes(entityId)) throw new AppError('FORBIDDEN', 403, 'Entité inaccessible');
  assertCan(actor, 'account.read', entityId);
  const today = localDay(new Date());
  const out: { label: string; USD: { income: number; expense: number }; CDF: { income: number; expense: number } }[] = [];
  for (let m = months - 1; m >= 0; m--) {
    const from = startOfMonth(today, m);
    const t = await periodTotals(entityId, from, endOfMonth(today, m));
    const pick = (c: Currency) => { const x = t.find((y) => y.currency === c)!; return { income: Number(x.income), expense: Number(x.expense) }; };
    out.push({ label: monthLabel(from), USD: pick('USD'), CDF: pick('CDF') });
  }
  return out;
}

/** Nombre de demandes de fonds par statut et par mois de création. */
export async function requestStats(actor: CurrentUser, entityIds: string[], months = 6) {
  const ids = accessibleEntityIds(actor).filter((id) => entityIds.includes(id));
  const byStatus = await prisma.fundRequest.groupBy({ by: ['status'], where: { entityId: { in: ids } }, _count: true });
  const today = localDay(new Date());
  const monthly: { label: string; count: number }[] = [];
  for (let m = months - 1; m >= 0; m--) {
    const from = startOfMonth(today, m);
    monthly.push({ label: monthLabel(from), count: await prisma.fundRequest.count({ where: { entityId: { in: ids }, createdAt: { gte: from, lte: endOfMonth(today, m) } } }) });
  }
  return { byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })), monthly };
}

/** Historique d'un taux (la plus récente valeur de chaque jour, toutes sources confondues). */
export async function rateHistory(actor: CurrentUser, base: Currency, quote: Currency, limit = 60) {
  if (actor.roles.length === 0) throw new AppError('FORBIDDEN', 403, 'Accès refusé');
  const rows = await prisma.exchangeRate.findMany({ where: { base, quote }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: limit });
  const byDay = new Map<string, number>();
  for (const r of rows) { const k = r.date.toISOString().slice(0, 10); if (!byDay.has(k)) byDay.set(k, Number(r.rate.toString())); }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, rate]) => ({ date, rate }));
}

/** Activité du journal d'audit par jour (barres) — pour les profils autorisés uniquement (le filtrage d'entité est fait par le service d'audit). */
export function activityByDay(dates: Date[], days = 14) {
  const today = localDay(new Date());
  const counts = new Map<number, number>();
  for (const d of dates) { const k = localDay(d).getTime(); counts.set(k, (counts.get(k) ?? 0) + 1); }
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(today.getTime() - (days - 1 - i) * DAY);
    return { label: `${new Date(day.getTime()).getUTCDate()}`, count: counts.get(day.getTime()) ?? 0 };
  });
}

export { toMoneyString };
