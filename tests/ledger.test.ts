import Decimal from 'decimal.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './helpers/db';
import { META, makeActor } from './helpers/fixtures';

type Db = typeof import('../src/server/db').prisma;
let prisma: Db;
let drop: () => Promise<void>;
let SEC = '';
let ECOLE = '';

let ledger: typeof import('../src/server/ledger');
let accounts: typeof import('../src/server/modules/accounts/service');
let transactions: typeof import('../src/server/modules/transactions/service');

const secController = () => makeActor('ctrl-sec', [{ entityId: SEC, role: 'CONTROLLER' }]);

beforeAll(async () => {
  const db = await createTestDb();
  drop = db.drop;
  prisma = (await import('../src/server/db')).prisma;
  ledger = await import('../src/server/ledger');
  accounts = await import('../src/server/modules/accounts/service');
  transactions = await import('../src/server/modules/transactions/service');
  SEC = (await prisma.entity.create({ data: { code: 'SEC', name: 'SEC SARL' } })).id;
  ECOLE = (await prisma.entity.create({ data: { code: 'ECOLE', name: 'École' } })).id;
});

afterAll(async () => {
  await drop?.();
});

async function cash(name: string, currency: 'USD' | 'CDF', opening?: string, entityId = SEC) {
  const actor = makeActor('ctrl', [{ entityId, role: 'CONTROLLER' }]);
  return accounts.createAccount(
    actor,
    { entityId, type: 'CASH', name, currency, openingBalance: opening },
    META,
  );
}

const post = (input: Parameters<typeof ledger.postTransaction>[1]) =>
  prisma.$transaction((tx) => ledger.postTransaction(tx, input));

const D = (v: string) => new Decimal(v) as unknown as import('../src/server/money').Money;

describe('soldes dérivés du grand livre', () => {
  it('solde = Σ des écritures, solde initial = écriture OPENING_BALANCE', async () => {
    const acc = await cash('Caisse A', 'USD', '100.00');
    expect(acc.balance).toBe('100.00');
    await post({ entityId: SEC, kind: 'INCOME', date: new Date(), description: 'Recette', createdById: 'u', lines: [{ accountId: acc.id, amount: D('50.50') }] });
    await post({ entityId: SEC, kind: 'EXPENSE', date: new Date(), description: 'Dépense', createdById: 'u', lines: [{ accountId: acc.id, amount: D('-20.25') }] });
    const bal = await ledger.getAccountBalance(prisma, acc.id);
    expect(bal.toFixed(2)).toBe('130.25');
    const opening = await prisma.financialTransaction.findFirst({ where: { kind: 'OPENING_BALANCE', entries: { some: { accountId: acc.id } } } });
    expect(opening).not.toBeNull();
  });

  it('une caisse ne peut pas devenir négative', async () => {
    const acc = await cash('Caisse B', 'USD', '100.00');
    await expect(
      post({ entityId: SEC, kind: 'EXPENSE', date: new Date(), description: 'Trop', createdById: 'u', lines: [{ accountId: acc.id, amount: D('-100.01') }] }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect((await ledger.getAccountBalance(prisma, acc.id)).toFixed(2)).toBe('100.00');
  });

  it('deux opérations concurrentes sur la même caisse ne passent pas toutes les deux', async () => {
    const acc = await cash('Caisse C', 'USD', '100.00');
    const attempt = () =>
      post({ entityId: SEC, kind: 'EXPENSE', date: new Date(), description: 'Concurrent', createdById: 'u', lines: [{ accountId: acc.id, amount: D('-80') }] });
    const results = await Promise.allSettled([attempt(), attempt(), attempt()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await ledger.getAccountBalance(prisma, acc.id)).toFixed(2)).toBe('20.00');
  });
});

describe('immuabilité', () => {
  it('DELETE / UPDATE sur LedgerEntry échouent', async () => {
    const acc = await cash('Caisse D', 'USD', '10.00');
    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { accountId: acc.id } });
    await expect(prisma.$executeRaw`DELETE FROM "LedgerEntry" WHERE "id" = ${entry.id}`).rejects.toThrow(/interdit/);
    await expect(prisma.$executeRaw`UPDATE "LedgerEntry" SET "amount" = 999 WHERE "id" = ${entry.id}`).rejects.toThrow(/interdit/);
  });

  it('DELETE sur FinancialTransaction et sur AuditLog échouent', async () => {
    const tx = await prisma.financialTransaction.findFirstOrThrow();
    await expect(prisma.$executeRaw`DELETE FROM "FinancialTransaction" WHERE "id" = ${tx.id}`).rejects.toThrow(/interdit/);
    const log = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.$executeRaw`DELETE FROM "AuditLog" WHERE "id" = ${log.id}`).rejects.toThrow(/interdit/);
    await expect(prisma.$executeRaw`UPDATE "AuditLog" SET "action" = 'x' WHERE "id" = ${log.id}`).rejects.toThrow(/interdit/);
  });

  it("la référence, le type et le montant d'une transaction sont intouchables", async () => {
    const tx = await prisma.financialTransaction.findFirstOrThrow();
    await expect(prisma.$executeRaw`UPDATE "FinancialTransaction" SET "description" = 'truqué' WHERE "id" = ${tx.id}`).rejects.toThrow(/interdite/);
  });

  it("la devise d'une écriture doit être celle du compte (trigger)", async () => {
    const acc = await cash('Caisse E', 'USD', '10.00');
    const tx = await prisma.financialTransaction.findFirstOrThrow();
    await expect(
      prisma.$executeRaw`INSERT INTO "LedgerEntry" ("id","txId","accountId","amount","currency") VALUES ('bad', ${tx.id}, ${acc.id}, 1, 'CDF'::"Currency")`,
    ).rejects.toThrow(/Devise/);
  });
});

describe('multidevises', () => {
  it('conversion enregistrée avec taux, date, source et contre-valeur', async () => {
    const usd = await cash('Caisse USD', 'USD', '100.00');
    const cdf = await cash('Caisse CDF', 'CDF');
    const tx = await post({
      entityId: SEC, kind: 'CASH_TO_CASH', date: new Date(), description: 'Change', createdById: 'u',
      lines: [{ accountId: usd.id, amount: D('-10.00') }, { accountId: cdf.id, amount: D('28000.00') }],
      fx: { fromAmount: D('10.00'), fromCurrency: 'USD', toAmount: D('28000.00'), toCurrency: 'CDF', rate: D('2800'), rateDate: new Date('2026-11-12'), rateSource: 'Banque' },
    });
    const fx = await prisma.fxConversion.findUniqueOrThrow({ where: { txId: tx.id } });
    expect(fx.rate.toString()).toBe('2800');
    expect(fx.rateSource).toBe('Banque');
    expect((await ledger.getAccountBalance(prisma, cdf.id)).toFixed(2)).toBe('28000.00');
  });

  it('refuse deux devises sans conversion, ou une conversion incohérente', async () => {
    const usd = await cash('U2', 'USD', '100.00');
    const cdf = await cash('C2', 'CDF');
    const lines = [{ accountId: usd.id, amount: D('-10.00') }, { accountId: cdf.id, amount: D('28000.00') }];
    await expect(post({ entityId: SEC, kind: 'CASH_TO_CASH', date: new Date(), description: 'x', createdById: 'u', lines }))
      .rejects.toMatchObject({ code: 'FX_REQUIRED' });
    await expect(post({
      entityId: SEC, kind: 'CASH_TO_CASH', date: new Date(), description: 'x', createdById: 'u', lines,
      fx: { fromAmount: D('10.00'), fromCurrency: 'USD', toAmount: D('28000.00'), toCurrency: 'CDF', rate: D('2000'), rateDate: new Date(), rateSource: 'Manuel' },
    })).rejects.toMatchObject({ code: 'FX_MISMATCH' });
  });

  it("une recette ne peut pas mélanger deux devises", async () => {
    const usd = await cash('U3', 'USD');
    const cdf = await cash('C3', 'CDF');
    await expect(post({
      entityId: SEC, kind: 'INCOME', date: new Date(), description: 'x', createdById: 'u',
      lines: [{ accountId: usd.id, amount: D('1') }, { accountId: cdf.id, amount: D('1') }],
    })).rejects.toMatchObject({ code: 'CURRENCY_MISMATCH' });
  });

  it('un transfert dans une seule devise doit être équilibré', async () => {
    const a = await cash('A3', 'USD', '50.00');
    const b = await cash('B3', 'USD');
    await expect(post({
      entityId: SEC, kind: 'CASH_TO_CASH', date: new Date(), description: 'x', createdById: 'u',
      lines: [{ accountId: a.id, amount: D('-10') }, { accountId: b.id, amount: D('12') }],
    })).rejects.toMatchObject({ code: 'INVALID_TRANSACTION' });
  });
});

describe('contre-passation', () => {
  it('remet les soldes à l’identique, lie la contre-passation, interdit la double contre-passation', async () => {
    const acc = await cash('Caisse R', 'USD', '100.00');
    const tx = await post({ entityId: SEC, kind: 'EXPENSE', date: new Date(), description: 'Erreur', createdById: 'u', lines: [{ accountId: acc.id, amount: D('-40') }] });
    expect((await ledger.getAccountBalance(prisma, acc.id)).toFixed(2)).toBe('60.00');

    const rev = await transactions.reverseTransaction(secController(), tx.id, 'Saisie en double', META);
    expect((await ledger.getAccountBalance(prisma, acc.id)).toFixed(2)).toBe('100.00');
    expect(rev.reversalOfId).toBe(tx.id);
    expect((await prisma.financialTransaction.findUniqueOrThrow({ where: { id: tx.id } })).status).toBe('REVERSED');
    expect(await prisma.auditLog.count({ where: { action: 'transaction.reverse', entityId: tx.id } })).toBe(1);

    await expect(transactions.reverseTransaction(secController(), tx.id, 'Encore une fois', META))
      .rejects.toMatchObject({ code: 'ALREADY_REVERSED' });
    await expect(transactions.reverseTransaction(secController(), rev.id, 'Annuler annulation', META))
      .rejects.toMatchObject({ code: 'CANNOT_REVERSE_REVERSAL' });
  });

  it('motif obligatoire et step-up requis', async () => {
    const acc = await cash('Caisse R2', 'USD', '100.00');
    const tx = await post({ entityId: SEC, kind: 'EXPENSE', date: new Date(), description: 'x', createdById: 'u', lines: [{ accountId: acc.id, amount: D('-5') }] });
    await expect(transactions.reverseTransaction(secController(), tx.id, '  ', META)).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    const noStepUp = makeActor('ctrl-sec', [{ entityId: SEC, role: 'CONTROLLER' }], { stepUp: false });
    await expect(transactions.reverseTransaction(noStepUp, tx.id, 'Motif valable', META)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
  });

  it("l'entité École ne peut pas contre-passer une opération de SEC", async () => {
    const acc = await cash('Caisse R3', 'USD', '100.00');
    const tx = await post({ entityId: SEC, kind: 'EXPENSE', date: new Date(), description: 'x', createdById: 'u', lines: [{ accountId: acc.id, amount: D('-5') }] });
    const ecoleController = makeActor('ctrl-eco', [{ entityId: ECOLE, role: 'CONTROLLER' }]);
    await expect(transactions.reverseTransaction(ecoleController, tx.id, 'Motif valable', META)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('une contre-passation de transfert multidevise restitue les deux soldes', async () => {
    const usd = await cash('U4', 'USD', '100.00');
    const cdf = await cash('C4', 'CDF');
    const tx = await post({
      entityId: SEC, kind: 'CASH_TO_CASH', date: new Date(), description: 'Change', createdById: 'u',
      lines: [{ accountId: usd.id, amount: D('-10.00') }, { accountId: cdf.id, amount: D('28000.00') }],
      fx: { fromAmount: D('10.00'), fromCurrency: 'USD', toAmount: D('28000.00'), toCurrency: 'CDF', rate: D('2800'), rateDate: new Date(), rateSource: 'BCC' },
    });
    await transactions.reverseTransaction(secController(), tx.id, 'Mauvais taux saisi', META);
    expect((await ledger.getAccountBalance(prisma, usd.id)).toFixed(2)).toBe('100.00');
    expect((await ledger.getAccountBalance(prisma, cdf.id)).toFixed(2)).toBe('0.00');
  });
});

describe('références et isolation des entités', () => {
  it('références séquentielles par entité/type/année', async () => {
    const acc = await cash('Caisse Ref', 'USD', '100.00', ECOLE);
    const t1 = await post({ entityId: ECOLE, kind: 'INCOME', date: new Date('2026-03-01'), description: 'a', createdById: 'u', lines: [{ accountId: acc.id, amount: D('1') }] });
    const t2 = await post({ entityId: ECOLE, kind: 'INCOME', date: new Date('2026-03-02'), description: 'b', createdById: 'u', lines: [{ accountId: acc.id, amount: D('1') }] });
    expect(t1.reference).toMatch(/^ECO-REC-2026-\d{5}$/);
    const n = (r: string) => Number(r.split('-')[3]);
    expect(n(t2.reference)).toBe(n(t1.reference) + 1);
  });

  it("un CASHIER de l'École ne voit aucun compte de SEC", async () => {
    await cash('Caisse SEC visible', 'USD', '10.00', SEC);
    await cash('Caisse ECOLE', 'USD', '10.00', ECOLE);
    const cashierEcole = makeActor('cash-eco', [{ entityId: ECOLE, role: 'CASHIER' }]);
    const list = await accounts.listAccounts(cashierEcole);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((a) => a.entityId === ECOLE)).toBe(true);
    // Même en demandant explicitement l'entité SEC :
    expect(await accounts.listAccounts(cashierEcole, { entityIds: [SEC] })).toHaveLength(0);

    const secAccount = await prisma.account.findFirstOrThrow({ where: { entityId: SEC } });
    await expect(accounts.getAccount(cashierEcole, secAccount.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(accounts.getBalance(cashierEcole, secAccount.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('un compte bancaire exige le step-up, et son numéro est masqué et chiffré', async () => {
    const noStepUp = makeActor('ctrl-x', [{ entityId: SEC, role: 'CONTROLLER' }], { stepUp: false });
    const input = { entityId: SEC, type: 'BANK' as const, name: 'Rawbank USD', currency: 'USD' as const, bankName: 'Rawbank', accountNumber: '00012345678' };
    await expect(accounts.createAccount(noStepUp, input, META)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    const acc = await accounts.createAccount(secController(), input, META);
    expect(acc.accountNumberMasked).toBe('****5678');
    expect(JSON.stringify(acc)).not.toContain('00012345678');
    const raw = await prisma.account.findUniqueOrThrow({ where: { id: acc.id } });
    expect(raw.accountNumberEnc).not.toContain('00012345678');
  });

  it("ADMIN crée un compte mais ne peut pas y poser de solde initial", async () => {
    const admin = makeActor('admin', [{ entityId: SEC, role: 'ADMIN' }]);
    const base = { entityId: SEC, type: 'CASH' as const, name: 'Caisse admin', currency: 'USD' as const };
    await expect(accounts.createAccount(admin, { ...base, openingBalance: '10.00' }, META)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const acc = await accounts.createAccount(admin, base, META);
    expect(acc.balance).toBe('0.00');
  });
});

