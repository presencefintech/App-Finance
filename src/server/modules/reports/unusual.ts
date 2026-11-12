import 'server-only';
import { prisma } from '@/server/db';
import { D, ZERO, sum, toMoneyString } from '@/server/money';

export interface UnusualOperation {
  reference: string; date: Date; beneficiary: string; categoryName: string; amount: string; currency: 'USD' | 'CDF'; reason: string;
}

const DAY = 86_400_000;

/**
 * Opérations inhabituelles (SPEC §8.2, v1) :
 *  • dépense > 3 × la moyenne de sa catégorie sur les 90 jours précédents (≥ 3 dépenses de référence) ;
 *  • doublon potentiel : même bénéficiaire + même montant + même devise à moins de 7 jours d'écart.
 * Seules les dépenses non contre-passées comptent.
 */
export async function unusualOperations(entityId: string, from: Date, to: Date): Promise<UnusualOperation[]> {
  const live = { status: 'POSTED' as const };
  const inRange = await prisma.expense.findMany({
    where: { entityId, date: { gte: from, lte: to } },
    orderBy: { date: 'asc' },
  });
  // Écarte les dépenses dont la transaction a été contre-passée.
  const refs = await prisma.financialTransaction.findMany({
    where: { reference: { in: inRange.map((e) => e.reference) }, ...live }, select: { reference: true },
  });
  const liveRefs = new Set(refs.map((r) => r.reference));
  const expenses = inRange.filter((e) => liveRefs.has(e.reference));
  if (expenses.length === 0) return [];

  const cats = await prisma.category.findMany({ where: { entityId }, select: { id: true, name: true } });
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const history = await prisma.expense.findMany({
    where: { entityId, date: { gte: new Date(from.getTime() - 90 * DAY), lt: from } },
    select: { categoryId: true, currency: true, amount: true },
  });

  const out: UnusualOperation[] = [];
  const seen = new Set<string>();
  const push = (e: (typeof expenses)[number], reason: string) => {
    const key = `${e.id}|${reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      reference: e.reference, date: e.date, beneficiary: e.beneficiary, categoryName: catName.get(e.categoryId) ?? '—',
      amount: toMoneyString(D(e.amount)), currency: e.currency, reason,
    });
  };

  for (const e of expenses) {
    const ref = history.filter((h) => h.categoryId === e.categoryId && h.currency === e.currency);
    if (ref.length >= 3) {
      const avg = sum(ref.map((h) => D(h.amount))).div(ref.length);
      if (avg.greaterThan(ZERO) && D(e.amount).greaterThan(avg.times(3))) {
        push(e, `Supérieure à 3 × la moyenne de la catégorie (${toMoneyString(avg)} ${e.currency})`);
      }
    }
  }
  for (let i = 0; i < expenses.length; i++) {
    for (let j = 0; j < expenses.length; j++) {
      const a = expenses[i]!;
      const b = expenses[j]!;
      if (i === j) continue;
      if (a.beneficiary.trim().toLowerCase() === b.beneficiary.trim().toLowerCase() && a.currency === b.currency
        && D(a.amount).equals(D(b.amount)) && Math.abs(a.date.getTime() - b.date.getTime()) <= 7 * DAY && a.date >= b.date && (a.date > b.date || i > j)) {
        push(a, `Doublon potentiel de ${b.reference} (même bénéficiaire et même montant à moins de 7 jours)`);
      }
    }
  }
  return out.sort((x, y) => y.date.getTime() - x.date.getTime());
}
