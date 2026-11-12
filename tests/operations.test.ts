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
let cash: typeof import('../src/server/modules/cash/service');
let txs: typeof import('../src/server/modules/transactions/service');
let totals: typeof import('../src/server/modules/reports/totals');
let ledger: typeof import('../src/server/ledger');

let SEC = '';
let ECOLE = '';
const A: Record<string, ReturnType<typeof makeActor>> = {};
const ids: Record<string, string> = {};

async function person(name: string, roles: { entityId: string; role: Role }[]) {
  const u = await prisma.user.create({ data: { email: `${name}@t.local`, fullName: name, passwordHash: 'x', roles: { create: roles } } });
  A[name] = makeActor(u.id, roles);
}
const bal = async (id: string) => (await ledger.getAccountBalance(prisma, id)).toFixed(2);
const range = () => [new Date(Date.now() - 86_400_000 * 2), new Date(Date.now() + 86_400_000)] as const;

beforeAll(async () => {
  const db = await createTestDb();
  drop = db.drop;
  prisma = (await import('../src/server/db')).prisma;
  accounts = await import('../src/server/modules/accounts/service');
  incomes = await import('../src/server/modules/incomes/service');
  expenses = await import('../src/server/modules/expenses/service');
  transfers = await import('../src/server/modules/transfers/service');
  cash = await import('../src/server/modules/cash/service');
  txs = await import('../src/server/modules/transactions/service');
  totals = await import('../src/server/modules/reports/totals');
  ledger = await import('../src/server/ledger');

  SEC = (await prisma.entity.create({ data: { code: 'SEC', name: 'SEC SARL' } })).id;
  ECOLE = (await prisma.entity.create({ data: { code: 'ECOLE', name: 'École' } })).id;
  await person('controller', [{ entityId: SEC, role: 'CONTROLLER' }]);
  await person('controller2', [{ entityId: SEC, role: 'CONTROLLER' }]);
  await person('cashier', [{ entityId: SEC, role: 'CASHIER' }]);
  await person('ecoleCashier', [{ entityId: ECOLE, role: 'CASHIER' }]);
  await person('ecoleController', [{ entityId: ECOLE, role: 'CONTROLLER' }]);

  const mk = (actor: string, entityId: string, type: 'CASH' | 'BANK', name: string, currency: 'USD' | 'CDF', opening?: string) =>
    accounts.createAccount(A[actor]!, { entityId, type, name, currency, openingBalance: opening, ...(type === 'BANK' ? { bankName: 'Rawbank' } : {}) }, META);
  ids.cash = (await mk('controller', SEC, 'CASH', 'Caisse', 'USD', '1000.00')).id;
  ids.cash2 = (await mk('controller', SEC, 'CASH', 'Caisse 2', 'USD')).id;
  ids.cashCdf = (await mk('controller', SEC, 'CASH', 'Caisse CDF', 'CDF')).id;
  ids.bank = (await mk('controller', SEC, 'BANK', 'Rawbank USD', 'USD', '5000.00')).id;
  ids.bankCdf = (await mk('controller', SEC, 'BANK', 'Rawbank CDF', 'CDF')).id;
  ids.ecoleCash = (await mk('ecoleController', ECOLE, 'CASH', 'Caisse École', 'USD', '300.00')).id;

  ids.catIncome = (await prisma.category.create({ data: { entityId: SEC, kind: 'INCOME', name: 'Partenaires' } })).id;
  ids.catExpense = (await prisma.category.create({ data: { entityId: SEC, kind: 'EXPENSE', name: 'Fournitures' } })).id;
  ids.ecoleCatIncome = (await prisma.category.create({ data: { entityId: ECOLE, kind: 'INCOME', name: 'Frais scolaires' } })).id;
});

afterAll(async () => {
  await drop?.();
});

describe('transferts ≠ recettes / dépenses (règle 6)', () => {
  it('versement, retrait, virement et transfert de caisse ne changent NI le total des recettes NI celui des dépenses', async () => {
    const [from, to] = range();
    const before = await totals.periodTotals(SEC, from, to);

    await transfers.depositToBank(A.cashier!, { cashAccountId: ids.cash!, bankAccountId: ids.bank!, amount: '200.00' }, META);
    const w = await transfers.initiateWithdrawal(A.controller!, { bankAccountId: ids.bank!, cashAccountId: ids.cash!, amount: '50.00' }, META);
    await transfers.confirmWithdrawal(A.cashier!, w.id, META);
    await transfers.transferCashToCash(A.cashier!, { fromAccountId: ids.cash!, toAccountId: ids.cash2!, amount: '30.00' }, META);

    expect(await totals.periodTotals(SEC, from, to)).toEqual(before);
  });

  it('les soldes reflètent exactement les transferts', async () => {
    // cash : 1000 − 200 (versement) + 50 (retrait) − 30 (cash2) = 820 ; bank : 5000 + 200 − 50 = 5150 ; cash2 : 30
    expect(await bal(ids.cash!)).toBe('820.00');
    expect(await bal(ids.bank!)).toBe('5150.00');
    expect(await bal(ids.cash2!)).toBe('30.00');
  });

  it('recettes et dépenses, elles, alimentent les totaux (par devise)', async () => {
    const [from, to] = range();
    const before = await totals.periodTotals(SEC, from, to);
    const usd0 = before.find((t) => t.currency === 'USD')!;
    await incomes.createIncome(A.controller!, { entityId: SEC, source: 'Partenaire X', categoryId: ids.catIncome!, amount: '100.00', currency: 'USD', paymentMethod: 'CASH', accountId: ids.cash! }, META);
    await expenses.createExpense(A.cashier!, { entityId: SEC, categoryId: ids.catExpense!, beneficiary: 'Papeterie', purpose: 'Cahiers', amount: '40.00', currency: 'USD', paymentMethod: 'CASH', accountId: ids.cash! }, META);
    await transfers.recordBankFee(A.controller!, { bankAccountId: ids.bank!, amount: '5.00', description: 'Frais de tenue de compte' }, META);
    const after = (await totals.periodTotals(SEC, from, to)).find((t) => t.currency === 'USD')!;
    expect(Number(after.income) - Number(usd0.income)).toBe(100);
    expect(Number(after.expense) - Number(usd0.expense)).toBe(45); // 40 + 5 de frais bancaires
    const cdf = (await totals.periodTotals(SEC, from, to)).find((t) => t.currency === 'CDF')!;
    expect(cdf).toEqual({ currency: 'CDF', income: '0.00', expense: '0.00' });
  });

  it('une opération contre-passée sort des totaux et les soldes reviennent à l’identique', async () => {
    const [from, to] = range();
    const income = await incomes.createIncome(A.controller!, { entityId: SEC, source: 'Erreur', categoryId: ids.catIncome!, amount: '25.00', currency: 'USD', paymentMethod: 'CASH', accountId: ids.cash2! }, META);
    const before = await bal(ids.cash2!);
    const tx = await prisma.financialTransaction.findFirstOrThrow({ where: { reference: income.reference } });
    const totalsWith = (await totals.periodTotals(SEC, from, to)).find((t) => t.currency === 'USD')!;
    await txs.reverseTransaction(A.controller!, tx.id, 'Saisie erronée', META);
    expect(Number(await bal(ids.cash2!))).toBe(Number(before) - 25);
    const totalsAfter = (await totals.periodTotals(SEC, from, to)).find((t) => t.currency === 'USD')!;
    expect(Number(totalsWith.income) - Number(totalsAfter.income)).toBe(25);
  });
});

describe('règles de saisie', () => {
  it('transfert entre entités refusé (c’est une avance), types de comptes contrôlés', async () => {
    await expect(transfers.transferCashToCash(A.cashier!, { fromAccountId: ids.cash!, toAccountId: ids.ecoleCash!, amount: '1.00' }, META))
      .rejects.toMatchObject({ code: 'NOT_FOUND' }); // le caissier SEC ne voit même pas le compte de l'École
    await expect(transfers.depositToBank(A.cashier!, { cashAccountId: ids.bank!, bankAccountId: ids.cash!, amount: '1.00' }, META))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('virement multidevise : conversion obligatoire, enregistrée avec taux/date/source', async () => {
    const base = { fromAccountId: ids.bank!, toAccountId: ids.bankCdf!, amount: '100.00' };
    await expect(transfers.transferBankToBank(A.controller!, base, META)).rejects.toMatchObject({ code: 'FX_REQUIRED' });
    const res = await transfers.transferBankToBank(A.controller!, { ...base, fx: { rate: '2800', rateDate: '2026-11-12', rateSource: 'BCC' } }, META);
    expect(await bal(ids.bankCdf!)).toBe('280000.00');
    const fx = await prisma.fxConversion.findFirstOrThrow({ where: { tx: { reference: res.reference } } });
    expect(fx.toAmount.toString()).toBe('280000');
    expect(fx.rateSource).toBe('BCC');
  });

  it('mode de paiement cohérent avec le compte, devise du compte respectée', async () => {
    const base = { entityId: SEC, source: 'X', categoryId: ids.catIncome!, amount: '10.00' };
    await expect(incomes.createIncome(A.controller!, { ...base, currency: 'USD', paymentMethod: 'BANK_TRANSFER', accountId: ids.cash! }, META)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(incomes.createIncome(A.controller!, { ...base, currency: 'CDF', paymentMethod: 'CASH', accountId: ids.cash! }, META)).rejects.toMatchObject({ code: 'CURRENCY_MISMATCH' });
  });

  it('catégories et départements sont propres à l’entité ; un caissier de l’École ne peut rien saisir sur SEC', async () => {
    await expect(incomes.createIncome(A.controller!, { entityId: SEC, source: 'X', categoryId: ids.ecoleCatIncome!, amount: '1.00', currency: 'USD', paymentMethod: 'CASH', accountId: ids.cash! }, META))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(expenses.createExpense(A.ecoleCashier!, { entityId: SEC, categoryId: ids.catExpense!, beneficiary: 'Z', purpose: 'test', amount: '1.00', currency: 'USD', paymentMethod: 'CASH', accountId: ids.cash! }, META))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    const list = await incomes.listIncomes(A.ecoleCashier!, { page: 1, pageSize: 100 });
    expect(list.data.every((i) => i.entityId === ECOLE)).toBe(true);
  });

  it('ni caisse négative ni dépense sans solde', async () => {
    await expect(expenses.createExpense(A.cashier!, { entityId: SEC, categoryId: ids.catExpense!, beneficiary: 'Gros', purpose: 'trop', amount: '999999.00', currency: 'USD', paymentMethod: 'CASH', accountId: ids.cash! }, META))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
  });
});

describe('retrait bancaire en deux temps', () => {
  it('en transit : aucune écriture ; la confirmation par le caissier fait bouger les soldes, une seule fois', async () => {
    const bankBefore = await bal(ids.bank!);
    const cashBefore = await bal(ids.cash2!);
    const w = await transfers.initiateWithdrawal(A.controller!, { bankAccountId: ids.bank!, cashAccountId: ids.cash2!, amount: '60.00' }, META);
    expect(w.status).toBe('IN_TRANSIT');
    expect(await bal(ids.bank!)).toBe(bankBefore);
    expect(await bal(ids.cash2!)).toBe(cashBefore);

    await expect(transfers.confirmWithdrawal(A.controller2!, w.id, META)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const results = await Promise.allSettled([transfers.confirmWithdrawal(A.cashier!, w.id, META), transfers.confirmWithdrawal(A.cashier!, w.id, META)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(Number(bankBefore) - Number(await bal(ids.bank!))).toBe(60);
    expect(Number(await bal(ids.cash2!)) - Number(cashBefore)).toBe(60);
  });

  it('un retrait annulé ne produit aucune écriture ; motif obligatoire', async () => {
    const before = await bal(ids.bank!);
    const w = await transfers.initiateWithdrawal(A.controller!, { bankAccountId: ids.bank!, cashAccountId: ids.cash!, amount: '10.00' }, META);
    await expect(transfers.cancelWithdrawal(A.controller!, w.id, '', META)).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    expect((await transfers.cancelWithdrawal(A.controller!, w.id, 'Erreur de montant', META)).status).toBe('CANCELLED');
    await expect(transfers.confirmWithdrawal(A.cashier!, w.id, META)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await bal(ids.bank!)).toBe(before);
  });

  it('retrait refusé si devises différentes ou solde bancaire insuffisant', async () => {
    await expect(transfers.initiateWithdrawal(A.controller!, { bankAccountId: ids.bank!, cashAccountId: ids.cashCdf!, amount: '10.00' }, META)).rejects.toMatchObject({ code: 'CURRENCY_MISMATCH' });
    await expect(transfers.initiateWithdrawal(A.controller!, { bankAccountId: ids.bank!, cashAccountId: ids.cash!, amount: '99999999.00' }, META)).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
  });
});

describe('clôture journalière de caisse', () => {
  it('écart ⇒ justification obligatoire, ajustement créé seulement après validation par une autre personne', async () => {
    const acc = (await accounts.createAccount(A.controller!, { entityId: SEC, type: 'CASH', name: 'Caisse clôture', currency: 'USD', openingBalance: '200.00' }, META)).id;
    const input = { countedBalance: '190.00' };
    await expect(cash.closeCashDay(A.cashier!, acc, input, META)).rejects.toMatchObject({ code: 'JUSTIFICATION_REQUIRED' });
    const session = await cash.closeCashDay(A.cashier!, acc, { ...input, justification: 'Billet de 10 introuvable' }, META);
    expect(session.status).toBe('PENDING_VALIDATION');
    expect(session.theoreticalBalance).toBe('200.00');
    expect(session.difference).toBe('-10.00');
    expect(await bal(acc)).toBe('200.00'); // aucune écriture avant validation

    await expect(cash.closeCashDay(A.cashier!, acc, { ...input, justification: 'Encore' }, META)).rejects.toMatchObject({ code: 'ALREADY_CLOSED' });
    await expect(cash.validateCashSession(A.cashier!, session.id, META)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const validated = await cash.validateCashSession(A.controller!, session.id, META);
    expect(validated.status).toBe('CLOSED');
    expect(await bal(acc)).toBe('190.00');
    await expect(cash.validateCashSession(A.controller2!, session.id, META)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('une fois la journée clôturée : plus de saisie sur cette caisse ce jour-là, seule la contre-passation passe', async () => {
    const acc = (await accounts.createAccount(A.controller!, { entityId: SEC, type: 'CASH', name: 'Caisse verrouillée', currency: 'USD', openingBalance: '100.00' }, META)).id;
    const inc = await incomes.createIncome(A.controller!, { entityId: SEC, source: 'Don', categoryId: ids.catIncome!, amount: '20.00', currency: 'USD', paymentMethod: 'CASH', accountId: acc }, META);
    await cash.closeCashDay(A.cashier!, acc, { countedBalance: '120.00' }, META);
    await expect(incomes.createIncome(A.controller!, { entityId: SEC, source: 'Tard', categoryId: ids.catIncome!, amount: '5.00', currency: 'USD', paymentMethod: 'CASH', accountId: acc }, META))
      .rejects.toMatchObject({ code: 'DAY_CLOSED' });
    await expect(incomes.createIncome(A.controller!, { entityId: SEC, source: 'Antidaté', categoryId: ids.catIncome!, amount: '5.00', currency: 'USD', paymentMethod: 'CASH', accountId: acc, date: new Date(Date.now() - 3 * 3600_000).toISOString() }, META))
      .rejects.toMatchObject({ code: 'DAY_CLOSED' });
    const tx = await prisma.financialTransaction.findFirstOrThrow({ where: { reference: inc.reference } });
    await txs.reverseTransaction(A.controller!, tx.id, 'Don annulé', META);
    expect(await bal(acc)).toBe('100.00');
  });

  it('le comptage par coupures doit correspondre au montant compté ; pas de clôture d’un jour futur', async () => {
    const acc = (await accounts.createAccount(A.controller!, { entityId: SEC, type: 'CASH', name: 'Caisse coupures', currency: 'USD', openingBalance: '170.00' }, META)).id;
    await expect(cash.closeCashDay(A.cashier!, acc, { countedBalance: '170.00', denominations: { '100': 1, '20': 2 } }, META)).rejects.toMatchObject({ code: 'DENOMINATIONS_MISMATCH' });
    await expect(cash.closeCashDay(A.cashier!, acc, { countedBalance: '170.00', date: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10) }, META)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const ok = await cash.closeCashDay(A.cashier!, acc, { countedBalance: '170.00', denominations: { '100': 1, '50': 1, '20': 1 } }, META);
    expect(ok.status).toBe('CLOSED');
    expect(ok.difference).toBe('0.00');
  });
});

describe('import CSV de recettes (totaux scolaires)', () => {
  it('tout ou rien : une ligne invalide annule l’import et toutes les erreurs sont listées', async () => {
    const before = await bal(ids.ecoleCash!);
    const bad = 'date;rubrique;montant;devise\n2026-11-10;Frais scolaires;1 200,50;USD\n10/11/2026;Inscriptions;abc;USD\n2026-11-11;Cantine;50;CDF';
    await expect(incomes.importIncomesCsv(A.ecoleController!, { entityId: ECOLE, accountId: ids.ecoleCash!, categoryId: ids.ecoleCatIncome!, csv: bad }, META))
      .rejects.toMatchObject({ code: 'IMPORT_INVALID', details: [{ line: 3 }, { line: 4 }] });
    expect(await bal(ids.ecoleCash!)).toBe(before);

    const good = 'date;rubrique;montant;devise\n2026-11-10;Frais scolaires;1 200,50;USD\n10/11/2026;Inscriptions;300;USD';
    const res = await incomes.importIncomesCsv(A.ecoleController!, { entityId: ECOLE, accountId: ids.ecoleCash!, categoryId: ids.ecoleCatIncome!, csv: good }, META);
    expect(res.imported).toBe(2);
    expect(Number(await bal(ids.ecoleCash!)) - Number(before)).toBe(1500.5);
  });
});
