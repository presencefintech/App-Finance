import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '../src/generated/prisma/enums';
import { createTestDb } from './helpers/db';
import { META, makeActor } from './helpers/fixtures';

type Db = typeof import('../src/server/db').prisma;
let prisma: Db;
let drop: () => Promise<void>;
let accounts: typeof import('../src/server/modules/accounts/service');
let incomes: typeof import('../src/server/modules/incomes/service');
let expenses: typeof import('../src/server/modules/expenses/service');
let transfers: typeof import('../src/server/modules/transfers/service');
let reports: typeof import('../src/server/modules/reports/builders');
let render: typeof import('../src/server/modules/reports/render');
let registers: typeof import('../src/server/modules/registers/service');
let unusual: typeof import('../src/server/modules/reports/unusual');
let dashboard: typeof import('../src/server/modules/dashboard/service');
let stats: typeof import('../src/server/modules/stats/service');
let txs: typeof import('../src/server/modules/transactions/service');
let ledger: typeof import('../src/server/ledger');

let SEC = '';
let ECOLE = '';
const A: Record<string, ReturnType<typeof makeActor>> = {};
const ids: Record<string, string> = {};
const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

const inc = (amount: string, d: number, accountId = ids.cash!, cat = ids.inSec!, cur: 'USD' | 'CDF' = 'USD') =>
  incomes.createIncome(A.ctrl!, { entityId: SEC, source: 'Client', categoryId: cat, amount, currency: cur, paymentMethod: 'CASH', accountId, date: day(d) }, META);
const exp = (amount: string, d: number, who: string, cat = ids.maint!, accountId = ids.cash!, cur: 'USD' | 'CDF' = 'USD') =>
  expenses.createExpense(A.ctrl!, { entityId: SEC, categoryId: cat, beneficiary: who, purpose: 'achat', amount, currency: cur, paymentMethod: 'CASH', accountId, date: day(d) }, META);


async function person(name: string, roles: { entityId: string; role: Role }[]) {
  const u = await prisma.user.create({ data: { email: `${name}@t.local`, fullName: name, passwordHash: 'x', roles: { create: roles } } });
  A[name] = makeActor(u.id, roles);
}

beforeAll(async () => {
  const db = await createTestDb();
  drop = db.drop;
  prisma = (await import('../src/server/db')).prisma;
  accounts = await import('../src/server/modules/accounts/service');
  incomes = await import('../src/server/modules/incomes/service');
  expenses = await import('../src/server/modules/expenses/service');
  transfers = await import('../src/server/modules/transfers/service');
  reports = await import('../src/server/modules/reports/builders');
  render = await import('../src/server/modules/reports/render');
  registers = await import('../src/server/modules/registers/service');
  unusual = await import('../src/server/modules/reports/unusual');
  dashboard = await import('../src/server/modules/dashboard/service');
  stats = await import('../src/server/modules/stats/service');
  txs = await import('../src/server/modules/transactions/service');
  ledger = await import('../src/server/ledger');

  SEC = (await prisma.entity.create({ data: { code: 'SEC', name: 'SEC SARL' } })).id;
  ECOLE = (await prisma.entity.create({ data: { code: 'ECOLE', name: 'École' } })).id;
  await person('ctrl', [{ entityId: SEC, role: 'CONTROLLER' }]);
  await person('ecoleCtrl', [{ entityId: ECOLE, role: 'CONTROLLER' }]);
  await person('overseer', [{ entityId: SEC, role: 'CONTROLLER' }, { entityId: ECOLE, role: 'CONTROLLER' }]);
  await person('cashier', [{ entityId: SEC, role: 'CASHIER' }]);

  const mk = (actor: string, entityId: string, type: 'CASH' | 'BANK', name: string, currency: 'USD' | 'CDF', opening: string) =>
    accounts.createAccount(A[actor]!, { entityId, type, name, currency, openingBalance: opening, openedAt: day(120) }, META);
  ids.cash = (await mk('ctrl', SEC, 'CASH', 'Caisse SEC', 'USD', '100000.00')).id;
  ids.cashCdf = (await mk('ctrl', SEC, 'CASH', 'Caisse CDF', 'CDF', '50000000.00')).id;
  ids.bank = (await mk('ctrl', SEC, 'BANK', 'Rawbank', 'USD', '5000.00')).id;
  ids.ecoCash = (await mk('ecoleCtrl', ECOLE, 'CASH', 'Caisse École', 'USD', '1000.00')).id;
  const c = async (entityId: string, kind: 'INCOME' | 'EXPENSE', name: string) => (await prisma.category.create({ data: { entityId, kind, name } })).id;
  ids.inSec = await c(SEC, 'INCOME', 'Partenaires');
  ids.maint = await c(SEC, 'EXPENSE', 'Maintenance');
  ids.trans = await c(SEC, 'EXPENSE', 'Transport');
  ids.inEco = await c(ECOLE, 'INCOME', 'Frais scolaires');

  // Historique de référence (catégorie Maintenance : 3 × 100 USD sur 90 jours précédant la période).
  for (const d of [60, 50, 40]) await exp('100.00', d, 'Atelier');
  // Période récente.
  await inc('1000.00', 3);
  await inc('2000000.00', 3, ids.cashCdf!, ids.inSec!, 'CDF');
  await exp('500.00', 1, 'Garage Neuf'); // > 3 × la moyenne de la catégorie
  await exp('85.00', 3, 'Station Total', ids.trans!);
  await exp('85.00', 2, 'Station Total', ids.trans!); // doublon potentiel
  await exp('40.00', 2, 'Taxi', ids.trans!);
  await transfers.depositToBank(A.cashier!, { cashAccountId: ids.cash!, bankAccountId: ids.bank!, amount: '700.00', date: day(2) }, META);
  await incomes.createIncome(A.ecoleCtrl!, { entityId: ECOLE, source: 'Parents', categoryId: ids.inEco!, amount: '300.00', currency: 'USD', paymentMethod: 'CASH', accountId: ids.ecoCash!, date: day(2) }, META);
});

afterAll(async () => {
  await drop?.();
});

const range = (days: number) => ({ from: new Date(Date.now() - days * 86_400_000), to: new Date() });
const sec = (r: Awaited<ReturnType<typeof reports.buildReport>>, suffix: string) => r.sections.find((s) => s.title === `SEC — ${suffix}`)!;

describe('rapports', () => {
  it('journalier / hebdomadaire / mensuel : sections attendues, totaux par devise, transferts exclus', async () => {
    const { from, to } = range(7);
    const weekly = await reports.buildReport(A.ctrl!, 'weekly', [SEC], from, to);
    const totals = sec(weekly, 'Recettes et dépenses');
    expect(totals.rows.find((r) => r.currency === 'USD')).toMatchObject({ income: '1000.00', expense: '710.00' }); // 500 + 85 + 85 + 40 ; le versement de 700 n'y est pas
    expect(totals.rows.find((r) => r.currency === 'CDF')).toMatchObject({ income: '2000000.00', expense: '0.00' });
    for (const s of ['Évolution jour par jour', 'Dépenses par catégorie', 'Avances ouvertes', 'Remboursements de la période', 'Opérations inhabituelles']) expect(sec(weekly, s)).toBeTruthy();

    const daily = await reports.buildReport(A.ctrl!, 'daily', [SEC], from, to);
    for (const s of ['Opérations', 'État des caisses', 'État des banques', 'Versements et retraits', 'Demandes traitées', 'Écarts de caisse', 'Opérations en attente']) expect(sec(daily, s)).toBeTruthy();
    expect(sec(daily, 'Versements et retraits').rows).toHaveLength(1);
    expect(sec(daily, 'État des banques').rows[0]).toMatchObject({ account: 'Rawbank', balance: '5700.00' });

    const monthly = await reports.buildReport(A.ctrl!, 'monthly', [SEC], range(30).from, to);
    for (const s of ['Analyse budgétaire', 'Frais bancaires', 'Rapprochements', 'Tendances (vs période précédente)']) expect(sec(monthly, s)).toBeTruthy();
  });

  it('dépenses par catégorie, un montant par devise', async () => {
    const { from, to } = range(7);
    const weekly = await reports.buildReport(A.ctrl!, 'weekly', [SEC], from, to);
    const byCat = sec(weekly, 'Dépenses par catégorie').rows;
    expect(byCat.find((r) => r.category === 'Transport')).toMatchObject({ amount: '210.00', currency: 'USD' });
    expect(byCat.find((r) => r.category === 'Maintenance')).toMatchObject({ amount: '500.00', currency: 'USD' });
  });

  it('séparation des entités : une contrôleuse de l’École ne reçoit jamais de données de SEC', async () => {
    const { from, to } = range(7);
    const r = await reports.buildReport(A.ecoleCtrl!, 'weekly', [SEC, ECOLE], from, to);
    expect(r.sections.every((s) => !s.title.startsWith('SEC'))).toBe(true);
    await expect(reports.buildReport(A.ecoleCtrl!, 'weekly', [SEC], from, to)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('vue des deux entités : sections séparées + comparaison côte à côte, jamais fusionnées', async () => {
    const { from, to } = range(7);
    const r = await reports.buildReport(A.overseer!, 'weekly', [SEC, ECOLE], from, to);
    expect(r.sections[0]!.title).toBe('Comparaison des entités');
    const cmp = r.sections[0]!.rows;
    expect(cmp.find((x) => x.entity === 'SEC SARL' && x.currency === 'USD')).toMatchObject({ income: '1000.00' });
    expect(cmp.find((x) => x.entity === 'École' && x.currency === 'USD')).toMatchObject({ income: '300.00' });
    expect(r.sections.some((s) => s.title.startsWith('SEC')) && r.sections.some((s) => s.title.startsWith('ECOLE'))).toBe(true);
  });

  it('une opération contre-passée sort du rapport', async () => {
    const e = await exp('77.00', 1, 'Erreur de saisie', ids.trans!);
    const { from, to } = range(7);
    const before = sec(await reports.buildReport(A.ctrl!, 'weekly', [SEC], from, to), 'Recettes et dépenses').rows.find((r) => r.currency === 'USD')!;
    const tx = await prisma.financialTransaction.findFirstOrThrow({ where: { reference: e.reference } });
    await txs.reverseTransaction(A.ctrl!, tx.id, 'Saisie en double', META);
    const after = sec(await reports.buildReport(A.ctrl!, 'weekly', [SEC], from, to), 'Recettes et dépenses').rows.find((r) => r.currency === 'USD')!;
    expect(Number(before.expense) - Number(after.expense)).toBe(77);
  });
});

describe('opérations inhabituelles', () => {
  it('dépense > 3 × la moyenne de sa catégorie, et doublon potentiel', async () => {
    const ops = await unusual.unusualOperations(SEC, new Date(Date.now() - 6 * 86_400_000), new Date());
    expect(ops.find((o) => o.beneficiary === 'Garage Neuf')?.reason).toContain('3 ×');
    const dup = ops.filter((o) => o.reason.startsWith('Doublon'));
    expect(dup).toHaveLength(1);
    expect(dup[0]!.beneficiary).toBe('Station Total');
    expect(ops.find((o) => o.beneficiary === 'Taxi')).toBeUndefined();
  });
});

describe('exports PDF et Excel', () => {
  it('PDF : fichier valide, plusieurs pages numérotées', async () => {
    const { from, to } = range(30);
    const doc = await reports.buildReport(A.ctrl!, 'monthly', [SEC], from, to);
    const pdf = await render.renderPdf(doc);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-8).toString()).toContain('%%EOF');
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it('Excel : une feuille par section, montants en cellules NUMÉRIQUES, devise en colonne', async () => {
    const { from, to } = range(7);
    const doc = await reports.buildReport(A.ctrl!, 'weekly', [SEC], from, to);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await render.renderXlsx(doc)) as unknown as ArrayBuffer);
    expect(wb.worksheets.length).toBe(doc.sections.length + 1); // + résumé
    const ws = wb.worksheets.find((w) => w.name.includes('Recettes'))!;
    const header = ws.getRow(1).values as (string | undefined)[];
    const incomeCol = header.indexOf('Recettes');
    const usdRow = ws.getRows(2, 2)!.find((r) => r.getCell(header.indexOf('Devise')).value === 'USD')!;
    const cell = usdRow.getCell(incomeCol);
    expect(typeof cell.value).toBe('number');
    expect(cell.value).toBe(1000);
    expect(cell.numFmt).toBe('#,##0.00');
  });
});

describe('registres et documents', () => {
  it('registres : entrées, sorties, versements, journal — totaux par devise', async () => {
    const { from, to } = range(10);
    const entrees = await registers.buildRegister(A.ctrl!, 'entrees', SEC, from, to);
    expect(entrees.sections[1]!.rows).toEqual(expect.arrayContaining([expect.objectContaining({ currency: 'USD', amount: '1000.00' }), expect.objectContaining({ currency: 'CDF', amount: '2000000.00' })]));
    const sorties = await registers.buildRegister(A.ctrl!, 'sorties', SEC, from, to);
    expect(sorties.sections[0]!.rows.length).toBeGreaterThanOrEqual(4);
    const vers = await registers.buildRegister(A.ctrl!, 'versements', SEC, from, to);
    expect(vers.sections[0]!.rows).toHaveLength(1);
    expect(vers.sections[0]!.rows[0]).toMatchObject({ amount: '700.00' });
    const journal = await registers.buildRegister(A.ctrl!, 'journalier', SEC, from, to);
    expect(journal.sections.map((s) => s.title)).toContain('Recettes et dépenses de la période (transferts exclus)');
    expect(entrees.signatures).toEqual(['Contrôleuse financière', 'Direction']);
    await expect(registers.buildRegister(A.ecoleCtrl!, 'entrees', SEC, from, to)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('document d’opération : PDF valide pour une dépense, isolé par entité', async () => {
    const tx = await prisma.financialTransaction.findFirstOrThrow({ where: { kind: 'EXPENSE', entityId: SEC } });
    const { pdf, reference } = await registers.buildTransactionDocument(A.ctrl!, tx.id);
    expect(reference).toBe(tx.reference);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    await expect(registers.buildTransactionDocument(A.ecoleCtrl!, tx.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('état de caisse : ouverture + mouvements = clôture', async () => {
    const doc = await registers.buildCashStatement(A.ctrl!, ids.cash!, new Date(Date.now() - 10 * 86_400_000), new Date());
    const rows = doc.sections[0]!.rows;
    const get = (l: string) => Number(rows.find((r) => r.label?.includes(l))!.amount);
    expect(get('ouverture') + get('mouvements')).toBeCloseTo(get('clôture'), 2);
    const bal = await ledger.getAccountBalance(prisma, ids.cash!);
    expect(get('clôture')).toBeCloseTo(Number(bal.toFixed(2)), 2);
  });
});

describe('tableau de bord et statistiques', () => {
  it('tableau de bord : totaux, soldes par devise, alertes (doublons), séparation des entités', async () => {
    const d = await dashboard.entityDashboard(A.ctrl!, SEC);
    expect(d.entity.code).toBe('SEC');
    expect(d.cash.find((c) => c.currency === 'CDF')!.total).toBe('52000000.00');
    expect(d.alerts.some((a) => a.text.includes('doublon'))).toBe(true);
    const all = await dashboard.dashboard(A.overseer!, [SEC, ECOLE]);
    expect(all.map((x) => x.entity.code)).toEqual(['SEC', 'ECOLE']);
    const mine = await dashboard.dashboard(A.ecoleCtrl!, [SEC, ECOLE]);
    expect(mine.map((x) => x.entity.code)).toEqual(['ECOLE']);
  });

  it('historique de solde : 30 points, le dernier égale le solde actuel', async () => {
    const h = await stats.balanceHistory(A.ctrl!, ids.cash!, 30);
    expect(h.points).toHaveLength(30);
    const bal = await ledger.getAccountBalance(prisma, ids.cash!);
    expect(h.points[29]!.balance).toBeCloseTo(Number(bal.toFixed(2)), 2);
    await expect(stats.balanceHistory(A.ecoleCtrl!, ids.cash!, 30)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('séries mensuelles et répartition par catégorie : par devise, hors transferts et opérations annulées', async () => {
    const m = await stats.monthlySeries(A.ctrl!, SEC, 6);
    expect(m).toHaveLength(6);
    expect(m.reduce((s, x) => s + x.USD.income, 0)).toBe(1000);
    const cats = await stats.categoryBreakdown(A.ctrl!, SEC, 'EXPENSE', new Date(Date.now() - 100 * 86_400_000), new Date());
    expect(cats.USD.find((c) => c.name === 'Maintenance')!.value).toBe(800); // 300 d'historique + 500
    expect(cats.USD.some((c) => c.name === 'Erreur de saisie')).toBe(false);
    expect(cats.CDF).toEqual([]);
  });
});
