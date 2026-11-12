import 'server-only';
import type { Currency } from '@/generated/prisma/enums';
import { localDay, localDayEnd } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import type { CurrentUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { getAccountBalance } from '@/server/ledger';
import { D, ZERO, toMoneyString } from '@/server/money';
import { accessibleEntityIds, assertCan } from '@/server/permissions';
import { listAdvances } from '../advances/service';
import { budgetExecution } from '../budgets/service';
import { periodTotals } from './totals';
import type { Column, Section, TabularDoc } from './types';
import { unusualOperations } from './unusual';

export type ReportType = 'daily' | 'weekly' | 'monthly';
export const REPORT_TYPES: readonly ReportType[] = ['daily', 'weekly', 'monthly'];
const TITLES: Record<ReportType, string> = { daily: 'Rapport journalier', weekly: 'Rapport hebdomadaire', monthly: 'Rapport mensuel' };

const col = (key: string, label: string, type: Column['type'] = 'text', extra: Partial<Column> = {}): Column => ({ key, label, type, ...extra });
const CUR = col('currency', 'Devise', 'text', { width: 0.6 });
const money = (key: string, label: string) => col(key, label, 'money', { currencyKey: 'currency' });
const DAY = 86_400_000;

export function defaultReportRange(type: ReportType, now = new Date()) {
  const day = localDay(now);
  const startOfDay = new Date(day.getTime() - 2 * 3600_000);
  if (type === 'daily') return { from: startOfDay, to: localDayEnd(day) };
  if (type === 'weekly') return { from: new Date(startOfDay.getTime() - 6 * DAY), to: localDayEnd(day) };
  return { from: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1) - 2 * 3600_000), to: localDayEnd(day) };
}

type Entity = { id: string; code: string; name: string };

async function balances(entity: Entity, type: 'CASH' | 'BANK', at: Date): Promise<Section> {
  const accs = await prisma.account.findMany({ where: { entityId: entity.id, type }, orderBy: { name: 'asc' } });
  const rows = [];
  for (const a of accs) rows.push({ account: a.name, currency: a.currency, balance: toMoneyString(await getAccountBalance(prisma, a.id, at)) });
  return {
    title: `${entity.code} — ${type === 'CASH' ? 'État des caisses' : 'État des banques'}`,
    columns: [col('account', 'Compte', 'text', { width: 2 }), CUR, money('balance', 'Solde')], rows,
  };
}

async function totalsSection(entity: Entity, from: Date, to: Date): Promise<Section> {
  const t = await periodTotals(entity.id, from, to);
  return {
    title: `${entity.code} — Recettes et dépenses`,
    columns: [CUR, money('income', 'Recettes'), money('expense', 'Dépenses'), money('net', 'Solde')],
    rows: t.map((x) => ({ currency: x.currency, income: x.income, expense: x.expense, net: toMoneyString(D(x.income).minus(D(x.expense))) })),
    note: 'Les transferts (caisse/banque), avances et remboursements ne sont ni des recettes ni des dépenses.',
  };
}

async function operationsList(entity: Entity, from: Date, to: Date): Promise<Section> {
  const [inc, exp] = await Promise.all([
    prisma.income.findMany({ where: { entityId: entity.id, date: { gte: from, lte: to } }, orderBy: { date: 'asc' } }),
    prisma.expense.findMany({ where: { entityId: entity.id, date: { gte: from, lte: to } }, orderBy: { date: 'asc' } }),
  ]);
  const rows = [
    ...inc.map((r) => ({ date: r.date.toISOString(), reference: r.reference, type: 'Recette', label: r.source, amount: toMoneyString(D(r.amount)), currency: r.currency })),
    ...exp.map((r) => ({ date: r.date.toISOString(), reference: r.reference, type: 'Dépense', label: `${r.beneficiary} — ${r.purpose}`.slice(0, 90), amount: toMoneyString(D(r.amount).negated()), currency: r.currency })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return {
    title: `${entity.code} — Opérations`,
    columns: [col('date', 'Date', 'date', { width: 0.9 }), col('reference', 'Référence', 'text', { width: 1.4 }), col('type', 'Type', 'text', { width: 0.9 }), col('label', 'Libellé', 'text', { width: 2.5 }), money('amount', 'Montant'), CUR],
    rows,
  };
}

async function bankMovements(entity: Entity, from: Date, to: Date): Promise<Section> {
  const txs = await prisma.financialTransaction.findMany({
    where: { entityId: entity.id, status: 'POSTED', kind: { in: ['CASH_TO_BANK', 'BANK_TO_CASH'] }, date: { gte: from, lte: to } },
    include: { entries: true }, orderBy: { date: 'asc' },
  });
  return {
    title: `${entity.code} — Versements et retraits`,
    columns: [col('date', 'Date', 'date', { width: 0.9 }), col('reference', 'Référence', 'text', { width: 1.4 }), col('type', 'Type', 'text'), money('amount', 'Montant'), CUR],
    rows: txs.map((t) => {
      const out = t.entries.find((e) => D(e.amount).isNegative());
      return { date: t.date.toISOString(), reference: t.reference, type: t.kind === 'CASH_TO_BANK' ? 'Versement' : 'Retrait', amount: toMoneyString(D(out?.amount ?? '0').abs()), currency: out?.currency ?? 'USD' };
    }),
  };
}

async function requestsProcessed(entity: Entity, from: Date, to: Date): Promise<Section> {
  const events = await prisma.fundRequestEvent.findMany({
    where: { at: { gte: from, lte: to }, toStatus: { in: ['APPROVED', 'REJECTED', 'DISBURSED', 'CLOSED'] }, fundRequest: { entityId: entity.id } },
    include: { fundRequest: true }, orderBy: { at: 'asc' },
  });
  return {
    title: `${entity.code} — Demandes traitées`,
    columns: [col('date', 'Date', 'date', { width: 0.9 }), col('reference', 'Référence', 'text', { width: 1.4 }), col('status', 'Décision', 'text'), money('amount', 'Montant'), CUR],
    rows: events.map((e) => ({ date: e.at.toISOString(), reference: e.fundRequest.reference, status: e.toStatus, amount: toMoneyString(D(e.fundRequest.amount)), currency: e.fundRequest.currency })),
  };
}

async function cashDifferences(entity: Entity, from: Date, to: Date): Promise<Section> {
  const accs = await prisma.account.findMany({ where: { entityId: entity.id, type: 'CASH' }, select: { id: true, name: true, currency: true } });
  const sessions = await prisma.cashSession.findMany({
    where: { accountId: { in: accs.map((a) => a.id) }, date: { gte: localDay(from), lte: localDay(to) }, NOT: { difference: 0 } }, orderBy: { date: 'asc' },
  });
  const a = new Map(accs.map((x) => [x.id, x]));
  return {
    title: `${entity.code} — Écarts de caisse`,
    columns: [col('date', 'Jour', 'date', { width: 0.9 }), col('account', 'Caisse', 'text', { width: 1.6 }), money('difference', 'Écart'), CUR, col('status', 'Statut', 'text')],
    rows: sessions.map((s) => ({ date: s.date.toISOString(), account: a.get(s.accountId)?.name ?? '', difference: toMoneyString(D(s.difference)), currency: a.get(s.accountId)?.currency ?? 'USD', status: s.status === 'CLOSED' ? 'Validé' : 'En attente' })),
  };
}

async function pendingOperations(entity: Entity): Promise<Section> {
  const [pw, reqs] = await Promise.all([
    prisma.pendingTransfer.findMany({ where: { entityId: entity.id, status: 'IN_TRANSIT' } }),
    prisma.fundRequest.groupBy({ by: ['status'], where: { entityId: entity.id, status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED', 'APPROVED', 'DISBURSED', 'RECEIVED', 'JUSTIFIED'] } }, _count: true }),
  ]);
  const rows: Record<string, string>[] = reqs.map((r) => ({ label: `Demandes « ${r.status} »`, count: String(r._count) }));
  rows.push({ label: 'Retraits bancaires en transit', count: String(pw.length) });
  return { title: `${entity.code} — Opérations en attente`, columns: [col('label', 'Libellé', 'text', { width: 3 }), col('count', 'Nombre', 'int')], rows };
}

async function dailyEvolution(entity: Entity, from: Date, to: Date): Promise<Section> {
  const rows: Record<string, string>[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY) {
    const dayStart = new Date(t);
    const totals = await periodTotals(entity.id, dayStart, new Date(Math.min(t + DAY - 1, to.getTime())));
    for (const x of totals) if (!D(x.income).isZero() || !D(x.expense).isZero()) rows.push({ date: dayStart.toISOString(), currency: x.currency, income: x.income, expense: x.expense });
  }
  return { title: `${entity.code} — Évolution jour par jour`, columns: [col('date', 'Jour', 'date'), CUR, money('income', 'Recettes'), money('expense', 'Dépenses')], rows };
}

async function expensesByCategory(entity: Entity, from: Date, to: Date): Promise<Section> {
  const exp = await prisma.expense.findMany({ where: { entityId: entity.id, date: { gte: from, lte: to } } });
  const live = new Set((await prisma.financialTransaction.findMany({ where: { reference: { in: exp.map((e) => e.reference) }, status: 'POSTED' }, select: { reference: true } })).map((t) => t.reference));
  const cats = new Map((await prisma.category.findMany({ where: { entityId: entity.id } })).map((c) => [c.id, c.name]));
  const acc = new Map<string, ReturnType<typeof D>>();
  for (const e of exp.filter((x) => live.has(x.reference))) {
    const k = `${cats.get(e.categoryId) ?? '—'}|${e.currency}`;
    acc.set(k, (acc.get(k) ?? ZERO).plus(D(e.amount)));
  }
  return {
    title: `${entity.code} — Dépenses par catégorie`,
    columns: [col('category', 'Catégorie', 'text', { width: 2 }), CUR, money('amount', 'Montant')],
    rows: [...acc.entries()].map(([k, v]) => { const [category = '', currency = 'USD'] = k.split('|'); return { category, currency, amount: toMoneyString(v) }; }).sort((a, b) => Number(b.amount) - Number(a.amount)),
  };
}

async function advancesSection(actor: CurrentUser, entity: Entity): Promise<Section> {
  const adv = (await listAdvances(actor, { entityId: entity.id })).filter((a) => a.status === 'OPEN' || a.status === 'PARTIALLY_REPAID');
  return {
    title: `${entity.code} — Avances ouvertes`,
    columns: [col('reference', 'Référence', 'text', { width: 1.4 }), col('direction', 'Sens', 'text', { width: 1.8 }), money('remaining', 'Restant dû'), CUR, col('age', 'Jours', 'int', { width: 0.6 })],
    rows: adv.map((a) => ({ reference: a.reference, direction: a.lenderEntityId === entity.id ? `Avancé à ${a.borrowerName}` : `Reçu de ${a.lenderName}`, remaining: a.remaining, currency: a.currency, age: String(a.ageDays) })),
  };
}

async function repaymentsSection(entity: Entity, from: Date, to: Date): Promise<Section> {
  const reps = await prisma.advanceRepayment.findMany({
    where: { date: { gte: from, lte: to }, advance: { OR: [{ lenderEntityId: entity.id }, { borrowerEntityId: entity.id }] } }, include: { advance: true },
  });
  const live = new Set((await prisma.financialTransaction.findMany({ where: { id: { in: reps.map((r) => r.txId) }, status: 'POSTED' }, select: { id: true } })).map((t) => t.id));
  return {
    title: `${entity.code} — Remboursements de la période`,
    columns: [col('date', 'Date', 'date'), col('advance', 'Avance', 'text', { width: 1.6 }), money('amount', 'Montant'), CUR],
    rows: reps.filter((r) => live.has(r.txId)).map((r) => ({ date: r.date.toISOString(), advance: r.advance.reference, amount: toMoneyString(D(r.amount)), currency: r.currency })),
  };
}

async function unusualSection(entity: Entity, from: Date, to: Date): Promise<Section> {
  const ops = await unusualOperations(entity.id, from, to);
  return {
    title: `${entity.code} — Opérations inhabituelles`,
    columns: [col('date', 'Date', 'date', { width: 0.9 }), col('reference', 'Référence', 'text', { width: 1.4 }), col('beneficiary', 'Bénéficiaire'), money('amount', 'Montant'), CUR, col('reason', 'Motif', 'text', { width: 3 })],
    rows: ops.map((o) => ({ date: o.date.toISOString(), reference: o.reference, beneficiary: o.beneficiary, amount: o.amount, currency: o.currency, reason: o.reason })),
    note: 'Règles v1 : dépense > 3 × la moyenne de sa catégorie (90 jours) ; même bénéficiaire et même montant à moins de 7 jours.',
  };
}

async function bankFees(entity: Entity, from: Date, to: Date): Promise<Section> {
  const t = await prisma.$queryRaw<{ currency: Currency; total: string }[]>`
    SELECT e."currency" AS currency, COALESCE(SUM(-e."amount"), 0)::text AS total
    FROM "LedgerEntry" e JOIN "FinancialTransaction" t ON t."id" = e."txId"
    WHERE t."entityId" = ${entity.id} AND t."kind" = 'BANK_FEE' AND t."status" = 'POSTED' AND t."date" >= ${from} AND t."date" <= ${to}
    GROUP BY e."currency"`;
  return { title: `${entity.code} — Frais bancaires`, columns: [CUR, money('total', 'Total')], rows: t.map((r) => ({ currency: r.currency, total: toMoneyString(D(r.total)) })) };
}

async function reconciliations(entity: Entity, from: Date, to: Date): Promise<Section> {
  const sts = await prisma.bankStatement.findMany({ where: { entityId: entity.id, periodEnd: { gte: from, lte: to } }, orderBy: { periodEnd: 'asc' } });
  const accs = new Map((await prisma.account.findMany({ where: { entityId: entity.id }, select: { id: true, name: true } })).map((a) => [a.id, a.name]));
  return {
    title: `${entity.code} — Rapprochements`,
    columns: [col('account', 'Compte', 'text', { width: 2 }), col('period', 'Période', 'text', { width: 2 }), col('status', 'Statut')],
    rows: sts.map((s) => ({ account: accs.get(s.accountId) ?? '', period: `${formatDate(s.periodStart)} - ${formatDate(s.periodEnd)}`, status: s.status })),
  };
}

async function budgetAnalysis(actor: CurrentUser, entity: Entity, from: Date, to: Date): Promise<Section> {
  const budgets = await prisma.budget.findMany({ where: { entityId: entity.id, periodStart: { lte: to }, periodEnd: { gte: from } } });
  const rows: Record<string, string>[] = [];
  for (const b of budgets) {
    const exec = await budgetExecution(actor, b.id);
    for (const l of exec.lines) rows.push({ budget: b.name, line: l.label || 'Ensemble', currency: b.currency, amount: l.budget, committed: l.committed, realised: l.realised, available: l.available, pct: String(l.percentConsumed) });
  }
  return {
    title: `${entity.code} — Analyse budgétaire`,
    columns: [col('budget', 'Budget', 'text', { width: 1.6 }), col('line', 'Ligne', 'text', { width: 1.6 }), CUR, money('amount', 'Budget'), money('committed', 'Engagé'), money('realised', 'Réalisé'), money('available', 'Disponible'), col('pct', '% consommé', 'int', { width: 0.8 })],
    rows,
  };
}

async function trends(entity: Entity, from: Date, to: Date): Promise<Section> {
  const span = to.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - span - 1);
  const prevTo = new Date(from.getTime() - 1);
  const [cur, prev] = await Promise.all([periodTotals(entity.id, from, to), periodTotals(entity.id, prevFrom, prevTo)]);
  const pct = (a: string, b: string) => (D(b).isZero() ? '—' : `${D(a).minus(D(b)).div(D(b)).times(100).toDecimalPlaces(1).toString()} %`);
  return {
    title: `${entity.code} — Tendances (vs période précédente)`,
    columns: [CUR, money('income', 'Recettes'), money('prevIncome', 'Précédent'), col('dIncome', 'Évol. recettes', 'text', { width: 1 }), money('expense', 'Dépenses'), money('prevExpense', 'Précédent'), col('dExpense', 'Évol. dépenses', 'text', { width: 1 })],
    rows: cur.map((c) => { const p = prev.find((x) => x.currency === c.currency)!; return { currency: c.currency, income: c.income, prevIncome: p.income, dIncome: pct(c.income, p.income), expense: c.expense, prevExpense: p.expense, dExpense: pct(c.expense, p.expense) }; }),
  };
}

/** Comparaison des deux entités : côte à côte, par devise, JAMAIS fusionnées. */
async function comparison(entities: Entity[], from: Date, to: Date): Promise<Section> {
  const rows: Record<string, string>[] = [];
  for (const e of entities) for (const t of await periodTotals(e.id, from, to)) rows.push({ entity: e.name, currency: t.currency, income: t.income, expense: t.expense });
  return { title: 'Comparaison des entités', columns: [col('entity', 'Entité', 'text', { width: 1.6 }), CUR, money('income', 'Recettes'), money('expense', 'Dépenses')], rows, note: 'Chaque entité est présentée séparément ; aucun total consolidé entre entités ou devises.' };
}

/** ReportData typé → rendu PDF ou Excel. Toujours borné aux entités de l'utilisateur. */
export async function buildReport(actor: CurrentUser, type: ReportType, entityIds: string[], from: Date, to: Date): Promise<TabularDoc> {
  const allowed = accessibleEntityIds(actor).filter((id) => entityIds.includes(id));
  if (allowed.length === 0) throw new AppError('NOT_FOUND', 404, 'Entité introuvable');
  for (const id of allowed) assertCan(actor, 'report.read', id);
  const entities = await prisma.entity.findMany({ where: { id: { in: allowed } }, orderBy: { code: 'asc' } });
  const sections: Section[] = [];

  for (const e of entities) {
    sections.push(await totalsSection(e, from, to));
    if (type === 'daily') {
      sections.push(await operationsList(e, from, to), await balances(e, 'CASH', to), await balances(e, 'BANK', to), await bankMovements(e, from, to),
        await requestsProcessed(e, from, to), await cashDifferences(e, from, to), await pendingOperations(e));
    } else if (type === 'weekly') {
      sections.push(await dailyEvolution(e, from, to), await expensesByCategory(e, from, to), await advancesSection(actor, e), await repaymentsSection(e, from, to), await unusualSection(e, from, to));
    } else {
      sections.push(await balances(e, 'BANK', to), await balances(e, 'CASH', to), await expensesByCategory(e, from, to), await budgetAnalysis(actor, e, from, to),
        await advancesSection(actor, e), await bankFees(e, from, to), await reconciliations(e, from, to), await trends(e, from, to));
    }
  }
  if (entities.length > 1 && type !== 'daily') sections.unshift(await comparison(entities, from, to));

  return {
    title: TITLES[type], subtitle: `Du ${formatDate(from)} au ${formatDate(to)}`,
    entityName: entities.length === 1 ? entities[0]!.name : entities.map((e) => e.name).join(' · '),
    generatedAt: new Date(), generatedBy: actor.fullName, sections,
  };
}

