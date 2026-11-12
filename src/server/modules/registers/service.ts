import 'server-only';
import { amountInWords } from '@/lib/amount-words';
import { formatDate } from '@/lib/format';
import { localDay, localDayEnd } from '@/lib/dates';
import type { CurrentUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { D, sum, toMoneyString } from '@/server/money';
import { drawFooters, drawHeader, drawKeyValues, drawSignatureBoxes, drawTable, moneyPlain, newPdf, pdfSafe, toBuffer, drawSectionTitle } from '@/server/pdf';
import { accessibleEntityIds, assertCan } from '@/server/permissions';
import { listAdvances } from '../advances/service';
import { periodTotals } from '../reports/totals';
import type { Column, Section, TabularDoc } from '../reports/types';

export const REGISTER_TYPES = [
  'entrees', 'sorties', 'demandes', 'retraits', 'versements', 'avances', 'remboursements', 'journalier', 'mensuel',
] as const;
export type RegisterType = (typeof REGISTER_TYPES)[number];

const TITLES: Record<RegisterType, string> = {
  entrees: 'Registre des entrées', sorties: 'Registre des sorties', demandes: 'Registre des demandes de fonds',
  retraits: 'Registre des retraits bancaires', versements: 'Registre des versements bancaires', avances: 'Registre des avances inter-entités',
  remboursements: 'Registre des remboursements d’avances', journalier: 'Journal journalier', mensuel: 'Journal mensuel',
};

const col = (key: string, label: string, type: Column['type'] = 'text', extra: Partial<Column> = {}): Column => ({ key, label, type, ...extra });
const MONEY = (key = 'amount') => col(key, 'Montant', 'money', { currencyKey: 'currency' });
const CUR = col('currency', 'Devise', 'text', { width: 0.6 });

/** Totaux par devise d'une colonne de montants (jamais mélangés entre devises). */
function totalsSection(rows: Record<string, string>[], label = 'Total'): Section {
  const out: Record<string, string>[] = [];
  for (const currency of ['USD', 'CDF']) {
    const subset = rows.filter((r) => r.currency === currency && r.amount);
    if (subset.length) out.push({ label, currency, amount: toMoneyString(sum(subset.map((r) => D(r.amount ?? '0')))) });
  }
  return { title: 'Totaux par devise', columns: [col('label', 'Libellé'), CUR, MONEY()], rows: out };
}

export function defaultRange(type: RegisterType, now = new Date()) {
  const day = localDay(now);
  if (type === 'mensuel') {
    const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1) - 2 * 3600_000);
    return { from: start, to: localDayEnd(day) };
  }
  if (type === 'journalier') return { from: new Date(day.getTime() - 2 * 3600_000), to: localDayEnd(day) };
  return { from: new Date(day.getTime() - 30 * 86_400_000), to: localDayEnd(day) };
}

async function names(userIds: (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((x): x is string => Boolean(x)))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

/** Construit un registre (PDF ou Excel via le rendu commun) pour UNE entité accessible. */
export async function buildRegister(actor: CurrentUser, type: RegisterType, entityId: string, from: Date, to: Date): Promise<TabularDoc> {
  if (!accessibleEntityIds(actor).includes(entityId)) throw new AppError('NOT_FOUND', 404, 'Entité introuvable');
  assertCan(actor, 'account.read', entityId);
  const entity = await prisma.entity.findUniqueOrThrow({ where: { id: entityId } });
  const range = { gte: from, lte: to };
  const accounts = await prisma.account.findMany({ where: { entityId }, select: { id: true, name: true } });
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  let sections: Section[] = [];

  if (type === 'entrees') {
    const rows = await prisma.income.findMany({ where: { entityId, date: range }, orderBy: { date: 'asc' } });
    const cats = new Map((await prisma.category.findMany({ where: { entityId } })).map((c) => [c.id, c.name]));
    const data = rows.map((r) => ({ date: r.date.toISOString(), reference: r.reference, source: r.source, category: cats.get(r.categoryId) ?? '', account: accName.get(r.accountId) ?? '', amount: toMoneyString(D(r.amount)), currency: r.currency }));
    sections = [{ title: 'Entrées', columns: [col('date', 'Date', 'date', { width: 0.9 }), col('reference', 'Référence', 'text', { width: 1.4 }), col('source', 'Origine'), col('category', 'Catégorie'), col('account', 'Compte'), MONEY(), CUR], rows: data }, totalsSection(data)];
  } else if (type === 'sorties') {
    const rows = await prisma.expense.findMany({ where: { entityId, date: range }, orderBy: { date: 'asc' } });
    const cats = new Map((await prisma.category.findMany({ where: { entityId } })).map((c) => [c.id, c.name]));
    const data = rows.map((r) => ({ date: r.date.toISOString(), reference: r.reference, beneficiary: r.beneficiary, purpose: r.purpose, category: cats.get(r.categoryId) ?? '', amount: toMoneyString(D(r.amount)), currency: r.currency }));
    sections = [{ title: 'Sorties', columns: [col('date', 'Date', 'date', { width: 0.9 }), col('reference', 'Référence', 'text', { width: 1.4 }), col('beneficiary', 'Bénéficiaire'), col('purpose', 'Motif', 'text', { width: 2.2 }), col('category', 'Catégorie'), MONEY(), CUR], rows: data }, totalsSection(data)];
  } else if (type === 'demandes') {
    const rows = await prisma.fundRequest.findMany({ where: { entityId, createdAt: range }, orderBy: { createdAt: 'asc' } });
    const n = await names(rows.map((r) => r.requesterId));
    const data = rows.map((r) => ({ date: r.createdAt.toISOString(), reference: r.reference, requester: n.get(r.requesterId) ?? '', purpose: r.purpose.slice(0, 90), status: r.status, amount: toMoneyString(D(r.amount)), currency: r.currency }));
    sections = [{ title: 'Demandes de fonds', columns: [col('date', 'Date', 'date', { width: 0.9 }), col('reference', 'Référence', 'text', { width: 1.4 }), col('requester', 'Demandeur'), col('purpose', 'Motif', 'text', { width: 2.2 }), col('status', 'Statut', 'text', { width: 1 }), MONEY(), CUR], rows: data }, totalsSection(data, 'Total demandé')];
  } else if (type === 'retraits') {
    const rows = await prisma.pendingTransfer.findMany({ where: { entityId, initiatedAt: range }, orderBy: { initiatedAt: 'asc' } });
    const data = rows.map((r) => ({ date: r.initiatedAt.toISOString(), reference: r.reference, from: accName.get(r.bankAccountId) ?? '', to: accName.get(r.cashAccountId) ?? '', status: r.status, amount: toMoneyString(D(r.amount)), currency: r.currency }));
    sections = [{ title: 'Retraits bancaires', columns: [col('date', 'Date', 'date', { width: 0.9 }), col('reference', 'Référence', 'text', { width: 1.4 }), col('from', 'Banque'), col('to', 'Caisse'), col('status', 'Statut', 'text', { width: 1 }), MONEY(), CUR], rows: data }, totalsSection(data.filter((r) => r.status === 'CONFIRMED'), 'Total confirmé')];
  } else if (type === 'versements') {
    const txs = await prisma.financialTransaction.findMany({ where: { entityId, kind: 'CASH_TO_BANK', status: 'POSTED', date: range }, include: { entries: true }, orderBy: { date: 'asc' } });
    const data = txs.map((t) => {
      const out = t.entries.find((e) => D(e.amount).isNegative());
      const inn = t.entries.find((e) => D(e.amount).isPositive());
      return { date: t.date.toISOString(), reference: t.reference, from: accName.get(out?.accountId ?? '') ?? '', to: accName.get(inn?.accountId ?? '') ?? '', amount: toMoneyString(D(out?.amount ?? '0').abs()), currency: out?.currency ?? 'USD' };
    });
    sections = [{ title: 'Versements en banque', columns: [col('date', 'Date', 'date', { width: 0.9 }), col('reference', 'Référence', 'text', { width: 1.4 }), col('from', 'Caisse'), col('to', 'Banque'), MONEY(), CUR], rows: data }, totalsSection(data)];
  } else if (type === 'avances') {
    const adv = (await listAdvances(actor, { entityId })).filter((a) => a.date >= from && a.date <= to);
    const data = adv.map((a) => ({
      date: a.date.toISOString(), reference: a.reference,
      direction: a.lenderEntityId === entityId ? `Avancé à ${a.borrowerName}` : `Reçu de ${a.lenderName}`,
      status: a.status, repaid: a.repaid, remaining: a.remaining, amount: a.amount, currency: a.currency,
    }));
    sections = [{ title: 'Avances', columns: [col('date', 'Date', 'date', { width: 0.9 }), col('reference', 'Référence', 'text', { width: 1.4 }), col('direction', 'Sens', 'text', { width: 1.8 }), col('status', 'Statut', 'text', { width: 1.2 }), MONEY(), col('repaid', 'Remboursé', 'money', { currencyKey: 'currency' }), col('remaining', 'Restant', 'money', { currencyKey: 'currency' }), CUR], rows: data }];
  } else if (type === 'remboursements') {
    const reps = await prisma.advanceRepayment.findMany({ where: { date: range, advance: { OR: [{ lenderEntityId: entityId }, { borrowerEntityId: entityId }] } }, include: { advance: true }, orderBy: { date: 'asc' } });
    const live = new Set((await prisma.financialTransaction.findMany({ where: { id: { in: reps.map((r) => r.txId) }, status: 'POSTED' }, select: { id: true } })).map((t) => t.id));
    const data = reps.filter((r) => live.has(r.txId)).map((r) => ({ date: r.date.toISOString(), advance: r.advance.reference, amount: toMoneyString(D(r.amount)), currency: r.currency }));
    sections = [{ title: 'Remboursements', columns: [col('date', 'Date', 'date', { width: 0.9 }), col('advance', 'Avance', 'text', { width: 1.6 }), MONEY(), CUR], rows: data }, totalsSection(data)];
  } else {
    // journalier / mensuel : journal de toutes les écritures actives + totaux recettes/dépenses.
    const entries = await prisma.ledgerEntry.findMany({
      where: { account: { entityId }, tx: { date: range } },
      include: { tx: { select: { reference: true, date: true, kind: true, description: true, status: true } } },
      orderBy: [{ tx: { date: 'asc' } }, { createdAt: 'asc' }],
    });
    const data = entries.map((e) => ({ date: e.tx.date.toISOString(), reference: e.tx.reference, kind: e.tx.kind, description: `${e.tx.description.slice(0, 70)}${e.tx.status === 'REVERSED' ? ' [contre-passée]' : ''}`, account: accName.get(e.accountId) ?? '', amount: toMoneyString(D(e.amount)), currency: e.currency }));
    const totals = await periodTotals(entityId, from, to);
    sections = [
      { title: 'Journal des écritures', columns: [col('date', 'Date', 'date', { width: 0.9 }), col('reference', 'Référence', 'text', { width: 1.4 }), col('kind', 'Type', 'text', { width: 1.2 }), col('description', 'Libellé', 'text', { width: 2.2 }), col('account', 'Compte'), MONEY(), CUR], rows: data },
      { title: 'Recettes et dépenses de la période (transferts exclus)', columns: [CUR, col('income', 'Recettes', 'money', { currencyKey: 'currency' }), col('expense', 'Dépenses', 'money', { currencyKey: 'currency' })], rows: totals.map((t) => ({ currency: t.currency, income: t.income, expense: t.expense })) },
    ];
  }

  return {
    title: TITLES[type], subtitle: `Du ${formatDate(from)} au ${formatDate(to)}`, entityName: entity.name,
    generatedAt: new Date(), generatedBy: actor.fullName, signatures: ['Contrôleuse financière', 'Direction'], sections,
  };
}

/**
 * Document imprimable d'une opération (SPEC §7) : en-tête entité, numéro, date, référence, motif, montant en
 * chiffres ET en lettres, personnes concernées, cases de signature. Le document signé est ensuite scanné et
 * rattaché à l'opération (AttachmentKind.SIGNED_REGISTER).
 */
export async function buildTransactionDocument(actor: CurrentUser, txId: string): Promise<{ pdf: Buffer; reference: string }> {
  const tx = await prisma.financialTransaction.findUnique({ where: { id: txId }, include: { entries: true, fx: true } });
  if (!tx || !accessibleEntityIds(actor).includes(tx.entityId)) throw new AppError('NOT_FOUND', 404, 'Opération introuvable');
  assertCan(actor, 'account.read', tx.entityId);
  const entity = await prisma.entity.findUniqueOrThrow({ where: { id: tx.entityId } });
  const accs = await prisma.account.findMany({ where: { id: { in: tx.entries.map((e) => e.accountId) } }, select: { id: true, name: true, entityId: true } });
  const accName = new Map(accs.map((a) => [a.id, a.name]));

  const main = tx.entries.find((e) => D(e.amount).isNegative()) ?? tx.entries[0]!;
  const amount = toMoneyString(D(main.amount).abs());
  const currency = main.currency;

  const fr = tx.fundRequestId ? await prisma.fundRequest.findUnique({ where: { id: tx.fundRequestId } }) : null;
  const expense = tx.expenseId ? await prisma.expense.findUnique({ where: { id: tx.expenseId } }) : null;
  const income = tx.incomeId ? await prisma.income.findUnique({ where: { id: tx.incomeId } }) : null;
  const n = await names([tx.createdById, fr?.requesterId, fr?.approvedById, fr?.disbursedById]);

  const doc = newPdf();
  drawHeader(doc, { entityName: entity.name, title: titleFor(tx.kind), number: tx.reference, subtitle: `Date de valeur : ${formatDate(tx.date)}` });
  if (tx.status === 'REVERSED') doc.fillColor('#dc3b3b').font('Helvetica-Bold').text('OPÉRATION CONTRE-PASSÉE — document sans valeur de décaissement.').fillColor('#14221e').font('Helvetica').moveDown(0.5);

  const pairs: [string, string][] = [
    ['Référence', tx.reference],
    ['Motif', tx.description],
    ['Montant en chiffres', moneyPlain(amount, currency)],
    ['Montant en lettres', amountInWords(amount, currency)],
  ];
  if (tx.fx) pairs.push(['Conversion', `${moneyPlain(toMoneyString(D(tx.fx.fromAmount)), tx.fx.fromCurrency)} -> ${moneyPlain(toMoneyString(D(tx.fx.toAmount)), tx.fx.toCurrency)} (taux ${tx.fx.rate.toString()}, ${formatDate(tx.fx.rateDate)}, source ${tx.fx.rateSource})`]);
  drawKeyValues(doc, pairs);

  drawSectionTitle(doc, 'Mouvements');
  drawTable(doc,
    [col('account', 'Compte', 'text', { width: 2 }), MONEY(), CUR],
    tx.entries.map((e) => ({ account: accName.get(e.accountId) ?? '', amount: toMoneyString(D(e.amount)), currency: e.currency })));

  drawSectionTitle(doc, 'Personnes concernées');
  const people: [string, string][] = [['Enregistré par', n.get(tx.createdById) ?? '—']];
  if (fr) people.push(['Demandeur', n.get(fr.requesterId) ?? '—'], ['Approbateur', n.get(fr.approvedById ?? '') ?? '—'], ['Caissier', n.get(fr.disbursedById ?? '') ?? '—'], ['Demande liée', fr.reference]);
  if (expense) people.push(['Bénéficiaire', expense.beneficiary]);
  if (income) people.push(['Origine', income.source]);
  drawKeyValues(doc, people);

  drawSignatureBoxes(doc, ['Demandeur', 'Approbateur', 'Caissier', 'Bénéficiaire']);
  drawFooters(doc, new Date(), pdfSafe(actor.fullName));
  return { pdf: await toBuffer(doc), reference: tx.reference };
}

function titleFor(kind: string): string {
  const t: Record<string, string> = {
    INCOME: 'Bon d’entrée de fonds', EXPENSE: 'Bon de sortie de fonds', CASH_TO_BANK: 'Bordereau de versement en banque',
    BANK_TO_CASH: 'Bon de retrait bancaire', BANK_TO_BANK: 'Ordre de virement', CASH_TO_CASH: 'Transfert entre caisses',
    BANK_FEE: 'Frais bancaires', ADVANCE_DISBURSEMENT: 'Bon d’avance inter-entités', ADVANCE_REPAYMENT: 'Reçu de remboursement d’avance',
    CASH_ADJUSTMENT: 'Ajustement d’écart de caisse', OPENING_BALANCE: 'Solde d’ouverture', REVERSAL: 'Contre-passation',
  };
  return t[kind] ?? 'Pièce comptable';
}

/** État de caisse : solde d'ouverture, mouvements, solde de clôture ; clôtures et écarts de la période. */
export async function buildCashStatement(actor: CurrentUser, accountId: string, from: Date, to: Date): Promise<TabularDoc> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account || account.type !== 'CASH' || !accessibleEntityIds(actor).includes(account.entityId)) {
    throw new AppError('NOT_FOUND', 404, 'Caisse introuvable');
  }
  assertCan(actor, 'account.read', account.entityId);
  const entity = await prisma.entity.findUniqueOrThrow({ where: { id: account.entityId } });
  const before = await prisma.ledgerEntry.aggregate({ where: { accountId, tx: { date: { lt: from } } }, _sum: { amount: true } });
  const entries = await prisma.ledgerEntry.findMany({
    // Tous les mouvements réels (y compris une opération contre-passée ET sa contre-passation) : l'état doit coller au solde.
    where: { accountId, tx: { date: { gte: from, lte: to } } },
    include: { tx: { select: { reference: true, date: true, description: true, status: true } } },
    orderBy: [{ tx: { date: 'asc' } }, { createdAt: 'asc' }],
  });
  const opening = before._sum.amount ? D(before._sum.amount) : D('0');
  const delta = sum(entries.map((e) => D(e.amount)));
  const sessions = await prisma.cashSession.findMany({ where: { accountId, date: { gte: localDay(from), lte: localDay(to) } }, orderBy: { date: 'asc' } });
  const cur = account.currency;
  const col = (key: string, label: string, type: Column['type'] = 'text', extra: Partial<Column> = {}): Column => ({ key, label, type, ...extra });
  let running = opening;
  const rows = entries.map((e) => {
    running = running.plus(D(e.amount));
    return { date: e.tx.date.toISOString(), reference: e.tx.reference, label: `${e.tx.description.slice(0, 60)}${e.tx.status === 'REVERSED' ? ' [contre-passée]' : ''}`, amount: toMoneyString(D(e.amount)), balance: toMoneyString(running), currency: cur };
  });
  return {
    title: 'État de caisse', subtitle: `${account.name} — du ${formatDate(from)} au ${formatDate(to)}`, entityName: entity.name,
    generatedAt: new Date(), generatedBy: actor.fullName, signatures: ['Caissier', 'Contrôleuse financière'],
    sections: [
      { title: 'Soldes', columns: [col('label', 'Libellé', 'text', { width: 3 }), col('currency', 'Devise', 'text', { width: 0.6 }), col('amount', 'Montant', 'money', { currencyKey: 'currency' })], rows: [
        { label: 'Solde d’ouverture', currency: cur, amount: toMoneyString(opening) },
        { label: 'Total des mouvements', currency: cur, amount: toMoneyString(delta) },
        { label: 'Solde de clôture', currency: cur, amount: toMoneyString(opening.plus(delta)) },
      ] },
      { title: 'Mouvements', columns: [col('date', 'Date', 'date', { width: 0.9 }), col('reference', 'Référence', 'text', { width: 1.4 }), col('label', 'Libellé', 'text', { width: 2.4 }), col('amount', 'Montant', 'money', { currencyKey: 'currency' }), col('balance', 'Solde', 'money', { currencyKey: 'currency' }), col('currency', 'Devise', 'text', { width: 0.6 })], rows },
      { title: 'Clôtures de la période', columns: [col('date', 'Jour', 'date'), col('theoretical', 'Théorique', 'money', { currencyKey: 'currency' }), col('counted', 'Compté', 'money', { currencyKey: 'currency' }), col('difference', 'Écart', 'money', { currencyKey: 'currency' }), col('currency', 'Devise', 'text', { width: 0.6 }), col('status', 'Statut', 'text')],
        rows: sessions.map((s) => ({ date: s.date.toISOString(), theoretical: toMoneyString(D(s.theoreticalBalance)), counted: toMoneyString(D(s.countedBalance)), difference: toMoneyString(D(s.difference)), currency: cur, status: s.status === 'CLOSED' ? 'Clôturée' : 'Écart à valider' })) },
    ],
  };
}

/** Résumé d'une opération pour sa page de détail (document imprimable + scan signé). */
export async function getTransactionSummary(actor: CurrentUser, txId: string) {
  const tx = await prisma.financialTransaction.findUnique({ where: { id: txId }, include: { entries: true } });
  if (!tx || !accessibleEntityIds(actor).includes(tx.entityId)) throw new AppError('NOT_FOUND', 404, 'Opération introuvable');
  assertCan(actor, 'account.read', tx.entityId);
  const accs = await prisma.account.findMany({ where: { id: { in: tx.entries.map((e) => e.accountId) } }, select: { id: true, name: true } });
  const name = new Map(accs.map((a) => [a.id, a.name]));
  return {
    id: tx.id, entityId: tx.entityId, reference: tx.reference, kind: tx.kind, status: tx.status, date: tx.date, description: tx.description,
    entries: tx.entries.map((e) => ({ account: name.get(e.accountId) ?? '', amount: toMoneyString(D(e.amount)), currency: e.currency })),
  };
}
