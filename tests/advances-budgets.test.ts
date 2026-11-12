import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '../src/generated/prisma/enums';
import { createTestDb } from './helpers/db';
import { META, makeActor } from './helpers/fixtures';

type Db = typeof import('../src/server/db').prisma;
let prisma: Db;
let drop: () => Promise<void>;
let fr: typeof import('../src/server/modules/fund-requests/service');
let accounts: typeof import('../src/server/modules/accounts/service');
let advances: typeof import('../src/server/modules/advances/service');
let budgets: typeof import('../src/server/modules/budgets/service');
let totals: typeof import('../src/server/modules/reports/totals');
let txs: typeof import('../src/server/modules/transactions/service');
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
const usd = async (entityId: string) => (await totals.periodTotals(entityId, ...range())).find((t) => t.currency === 'USD')!;

/** Demande de SEC approuvée par la direction (au-dessus du plafond de la contrôleuse). */
async function approvedRequest(amount: string, departmentId?: string) {
  const r = await fr.createFundRequest(A.requester!, { entityId: SEC, amount, currency: 'USD', purpose: 'Achat de matériel informatique', departmentId, submit: true }, META);
  await fr.reviewFundRequest(A.secController!, r.id, META);
  if (Number(amount) > 500) {
    await fr.escalateFundRequest(A.secController!, r.id, undefined, META);
    return fr.approveFundRequest(A.secDirector!, r.id, undefined, META);
  }
  return fr.approveFundRequest(A.secController!, r.id, undefined, META);
}

beforeAll(async () => {
  const db = await createTestDb();
  drop = db.drop;
  prisma = (await import('../src/server/db')).prisma;
  fr = await import('../src/server/modules/fund-requests/service');
  accounts = await import('../src/server/modules/accounts/service');
  advances = await import('../src/server/modules/advances/service');
  budgets = await import('../src/server/modules/budgets/service');
  totals = await import('../src/server/modules/reports/totals');
  txs = await import('../src/server/modules/transactions/service');
  ledger = await import('../src/server/ledger');

  SEC = (await prisma.entity.create({ data: { code: 'SEC', name: 'SEC SARL' } })).id;
  ECOLE = (await prisma.entity.create({ data: { code: 'ECOLE', name: 'École' } })).id;
  await person('requester', [{ entityId: SEC, role: 'REQUESTER' }]);
  await person('secController', [{ entityId: SEC, role: 'CONTROLLER' }]);
  await person('secDirector', [{ entityId: SEC, role: 'DIRECTOR' }]);
  await person('secCashier', [{ entityId: SEC, role: 'CASHIER' }]);
  await person('ecoleCashier', [{ entityId: ECOLE, role: 'CASHIER' }]);
  await person('ecoleController', [{ entityId: ECOLE, role: 'CONTROLLER' }]);
  await person('overseer', [{ entityId: SEC, role: 'CONTROLLER' }, { entityId: ECOLE, role: 'CONTROLLER' }]);

  const mk = (actor: string, entityId: string, type: 'CASH' | 'BANK', name: string, currency: 'USD' | 'CDF', opening?: string) =>
    accounts.createAccount(A[actor]!, { entityId, type, name, currency, openingBalance: opening }, META);
  ids.secCash = (await mk('secController', SEC, 'CASH', 'Caisse SEC', 'USD', '500.00')).id;
  ids.secBank = (await mk('overseer', SEC, 'BANK', 'Banque SEC USD', 'USD', '10000.00')).id;
  ids.ecoleCash = (await mk('ecoleController', ECOLE, 'CASH', 'Caisse École', 'USD', '3000.00')).id;
  ids.ecoleCashCdf = (await mk('ecoleController', ECOLE, 'CASH', 'Caisse École CDF', 'CDF')).id;
  ids.dept = (await prisma.department.create({ data: { entityId: SEC, name: 'Informatique' } })).id;
});

afterAll(async () => {
  await drop?.();
});

describe('scénario du cahier des charges : SEC demande 2 000 USD, l’École avance', () => {
  let requestId = '';
  let advanceId = '';

  it('la caisse SEC est insuffisante ; sans confirmation explicite, aucune avance n’est créée', async () => {
    const r = await approvedRequest('2000.00');
    requestId = r.id;
    expect(r.status).toBe('APPROVED');
    await expect(fr.disburseFundRequest(A.secCashier!, r.id, { accountId: ids.secCash! }, META)).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });

    await expect(fr.disburseFundRequest(A.ecoleCashier!, r.id, { accountId: ids.ecoleCash! }, META))
      .rejects.toMatchObject({ code: 'ADVANCE_CONFIRMATION_REQUIRED', details: { lender: 'École', borrower: 'SEC SARL', amount: '2000.00' } });
    expect(await bal(ids.ecoleCash!)).toBe('3000.00');
    expect(await prisma.interEntityAdvance.count()).toBe(0);
  });

  it('un caissier de SEC ne peut pas débiter un compte de l’École, ni un caissier sans droit sur l’entité prêteuse', async () => {
    await expect(fr.disburseFundRequest(A.secCashier!, requestId, { accountId: ids.ecoleCash!, confirmAdvance: true }, META)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('l’École décaisse : avance de 2 000 USD visible des DEUX côtés, dette de SEC = 2 000', async () => {
    const before = { ecole: await usd(ECOLE), sec: await usd(SEC) };
    const res = await fr.disburseFundRequest(A.ecoleCashier!, requestId, { accountId: ids.ecoleCash!, confirmAdvance: true }, META);
    expect(res.status).toBe('DISBURSED');
    expect(await bal(ids.ecoleCash!)).toBe('1000.00');

    const fromEcole = await advances.listAdvances(A.ecoleController!);
    const fromSec = await advances.listAdvances(A.secController!);
    expect(fromEcole).toHaveLength(1);
    expect(fromSec).toHaveLength(1);
    const adv = fromSec[0]!;
    advanceId = adv.id;
    expect(adv).toMatchObject({ amount: '2000.00', currency: 'USD', status: 'OPEN', remaining: '2000.00', lenderName: 'École', borrowerName: 'SEC SARL' });

    const secTotals = await advances.openAdvanceTotals(A.secController!, SEC);
    expect(secTotals.payable.find((t) => t.currency === 'USD')!.total).toBe('2000.00'); // dette
    expect(secTotals.receivable.find((t) => t.currency === 'USD')!.total).toBe('0.00');
    const ecoleTotals = await advances.openAdvanceTotals(A.ecoleController!, ECOLE);
    expect(ecoleTotals.receivable.find((t) => t.currency === 'USD')!.total).toBe('2000.00'); // créance

    // Règle 7 : ni recette ni dépense commerciale pour l'École ; la dépense revient à SEC.
    const after = { ecole: await usd(ECOLE), sec: await usd(SEC) };
    expect(after.ecole).toEqual(before.ecole);
    expect(after.ecole.income).toBe(before.ecole.income);
    expect(Number(after.sec.expense) - Number(before.sec.expense)).toBe(2000);
    expect(after.sec.income).toBe(before.sec.income);

    const expense = await prisma.expense.findFirstOrThrow({ where: { fundRequestId: requestId } });
    expect(expense.entityId).toBe(SEC);
  });

  it('le caissier de l’École ne voit pas le détail de la demande de SEC', async () => {
    await expect(fr.getFundRequest(A.ecoleCashier!, requestId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('remboursement de 500 → restant 1 500, PARTIALLY_REPAID ; la recette de l’École n’augmente pas', async () => {
    const ecoleBefore = await usd(ECOLE);
    const res = await advances.repayAdvance(A.overseer!, advanceId, { fromAccountId: ids.secBank!, toAccountId: ids.ecoleCash!, amount: '500.00' }, META);
    expect(res.remaining).toBe('1500.00');
    expect(res.status).toBe('PARTIALLY_REPAID');
    expect(res.repayments).toHaveLength(1);
    expect(await bal(ids.ecoleCash!)).toBe('1500.00');
    expect(await bal(ids.secBank!)).toBe('9500.00');
    expect(await usd(ECOLE)).toEqual(ecoleBefore); // un remboursement n'est pas une recette
  });

  it('surpaiement refusé ; remboursement total ⇒ REPAID ; refus ensuite', async () => {
    await expect(advances.repayAdvance(A.overseer!, advanceId, { fromAccountId: ids.secBank!, toAccountId: ids.ecoleCash!, amount: '1500.01' }, META))
      .rejects.toMatchObject({ code: 'ADVANCE_OVERPAYMENT' });
    const done = await advances.repayAdvance(A.overseer!, advanceId, { fromAccountId: ids.secBank!, toAccountId: ids.ecoleCash!, amount: '1500.00' }, META);
    expect(done.status).toBe('REPAID');
    expect(done.remaining).toBe('0.00');
    await expect(advances.repayAdvance(A.overseer!, advanceId, { fromAccountId: ids.secBank!, toAccountId: ids.ecoleCash!, amount: '1.00' }, META))
      .rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});

describe('remboursement et contre-passation', () => {
  it('sens imposé (emprunteur → prêteur), droits sur les deux entités requis', async () => {
    const r = await approvedRequest('100.00');
    await fr.disburseFundRequest(A.ecoleCashier!, r.id, { accountId: ids.ecoleCash!, confirmAdvance: true }, META);
    const adv = (await advances.listAdvances(A.overseer!, { status: 'OPEN' }))[0]!;
    await expect(advances.repayAdvance(A.overseer!, adv.id, { fromAccountId: ids.ecoleCash!, toAccountId: ids.secBank!, amount: '10.00' }, META))
      .rejects.toMatchObject({ code: 'ENTITY_MISMATCH' });
    await expect(advances.repayAdvance(A.secController!, adv.id, { fromAccountId: ids.secBank!, toAccountId: ids.ecoleCash!, amount: '10.00' }, META))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('remboursement dans l’autre devise : conversion enregistrée, restant calculé en devise de l’avance', async () => {
    const adv = (await advances.listAdvances(A.overseer!, { status: 'OPEN' }))[0]!;
    const base = { fromAccountId: ids.secBank!, toAccountId: ids.ecoleCashCdf!, amount: '40.00' };
    await expect(advances.repayAdvance(A.overseer!, adv.id, base, META)).rejects.toMatchObject({ code: 'FX_REQUIRED' });
    const res = await advances.repayAdvance(A.overseer!, adv.id, { ...base, fx: { rate: '2800', rateDate: '2026-11-12', rateSource: 'Banque' } }, META);
    expect(res.remaining).toBe('60.00');
    expect(await bal(ids.ecoleCashCdf!)).toBe('112000.00');
    const fx = await prisma.fxConversion.findFirstOrThrow({ where: { tx: { kind: 'ADVANCE_REPAYMENT' } } });
    expect(fx.rateSource).toBe('Banque');
  });

  it('contre-passer un remboursement recalcule le restant ; le décaissement ne s’annule qu’après', async () => {
    const adv = (await advances.listAdvances(A.overseer!, { status: 'PARTIALLY_REPAID' }))[0]!;
    const disb = await prisma.financialTransaction.findFirstOrThrow({ where: { advanceId: adv.id, kind: 'ADVANCE_DISBURSEMENT' } });
    await expect(txs.reverseTransaction(A.ecoleController!, disb.id, 'Erreur de saisie', META)).rejects.toMatchObject({ code: 'ADVANCE_HAS_REPAYMENTS' });

    const rep = await prisma.financialTransaction.findFirstOrThrow({ where: { advanceId: adv.id, kind: 'ADVANCE_REPAYMENT', status: 'POSTED' } });
    await txs.reverseTransaction(A.overseer!, rep.id, 'Paiement non reçu', META);
    const after = await advances.getAdvance(A.overseer!, adv.id);
    expect(after.remaining).toBe('100.00');
    expect(after.status).toBe('OPEN');
    expect(after.repayments[0]!.reversed).toBe(true);

    await txs.reverseTransaction(A.ecoleController!, disb.id, 'Décaissement erroné', META);
    expect((await advances.getAdvance(A.overseer!, adv.id)).status).toBe('CANCELLED');
  });
});

describe('avance manuelle', () => {
  it('la contrôleuse enregistre une dépense de SEC payée par l’École ; un caissier ne le peut pas', async () => {
    const input = { lenderAccountId: ids.ecoleCash!, borrowerEntityId: SEC, amount: '75.00', beneficiary: 'Garage Kolwezi', purpose: 'Réparation véhicule SEC' };
    await expect(advances.createManualAdvance(A.ecoleCashier!, input, META)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const before = await usd(ECOLE);
    const adv = await advances.createManualAdvance(A.ecoleController!, input, META);
    expect(adv).toMatchObject({ amount: '75.00', status: 'OPEN', lenderName: 'École', borrowerName: 'SEC SARL' });
    expect(await usd(ECOLE)).toEqual(before);
    await expect(advances.createManualAdvance(A.ecoleController!, { ...input, borrowerEntityId: ECOLE }, META)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('budgets et engagements', () => {
  it('engagé = approuvé non décaissé ; réalisé = dépenses ; disponible, % et alertes 80 % / 100 %', async () => {
    const start = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const end = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const { id } = await budgets.createBudget(A.secController!, {
      entityId: SEC, name: 'Budget informatique', periodStart: start, periodEnd: end, currency: 'USD',
      lines: [{ departmentId: ids.dept!, amount: '1000.00' }],
    }, META);

    const empty = await budgets.budgetExecution(A.secController!, id);
    expect(empty.lines[0]).toMatchObject({ budget: '1000.00', committed: '0.00', realised: '0.00', available: '1000.00', percentConsumed: 0, alert: 'OK' });

    // Approuvée (350) mais non décaissée : engagée uniquement.
    const r1 = await approvedRequest('350.00', ids.dept);
    let exec = await budgets.budgetExecution(A.secController!, id);
    expect(exec.lines[0]).toMatchObject({ committed: '350.00', realised: '0.00', available: '650.00', percentConsumed: 35 });

    // Décaissée : bascule d'engagé vers réalisé.
    await fr.disburseFundRequest(A.secCashier!, r1.id, { accountId: ids.secCash! }, META);
    exec = await budgets.budgetExecution(A.secController!, id);
    expect(exec.lines[0]).toMatchObject({ committed: '0.00', realised: '350.00', available: '650.00' });

    // 350 + 460 = 810 ⇒ alerte 80 %.
    await approvedRequest('100.00', ids.dept);
    await approvedRequest('360.00', ids.dept);
    exec = await budgets.budgetExecution(A.secController!, id);
    expect(exec.lines[0]!.percentConsumed).toBeGreaterThanOrEqual(80);
    expect(['WARN_80', 'OVER_100']).toContain(exec.lines[0]!.alert);
  });

  it('l’approbation d’une demande qui dépasse la ligne affiche un avertissement NON bloquant', async () => {
    const start = new Date(Date.now() - 86_400_000).toISOString();
    const end = new Date(Date.now() + 86_400_000).toISOString();
    const dept2 = (await prisma.department.create({ data: { entityId: SEC, name: 'Logistique' } })).id;
    await budgets.createBudget(A.secController!, {
      entityId: SEC, name: 'Budget logistique', periodStart: start, periodEnd: end, currency: 'USD', lines: [{ departmentId: dept2, amount: '100.00' }],
    }, META);
    const r = await fr.createFundRequest(A.requester!, { entityId: SEC, amount: '150.00', currency: 'USD', purpose: 'Carburant pour livraisons', departmentId: dept2, submit: true }, META);
    await fr.reviewFundRequest(A.secController!, r.id, META);
    const approved = await fr.approveFundRequest(A.secController!, r.id, undefined, META);
    expect(approved.status).toBe('APPROVED'); // non bloquant
    expect(approved.warnings).toHaveLength(1);
    expect(approved.warnings[0]).toContain('dépassé de 50.00 USD');
    const detail = await fr.getFundRequest(A.secController!, r.id);
    expect(detail.events.at(-1)?.comment).toContain('⚠');
  });

  it('droits : budgets propres à l’entité ; la prévision de trésorerie combine soldes, engagements et recettes', async () => {
    await expect(budgets.createBudget(A.ecoleController!, {
      entityId: SEC, name: 'Intrus', periodStart: new Date().toISOString(), periodEnd: new Date(Date.now() + 86_400_000).toISOString(), currency: 'USD',
      lines: [{ categoryId: 'x', amount: '1.00' }],
    }, META)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await budgets.listBudgets(A.ecoleController!)).toHaveLength(0);

    const [usdForecast] = await budgets.treasuryForecast(A.secController!, SEC, 4);
    expect(usdForecast!.currency).toBe('USD');
    const expected = Number(usdForecast!.balance) - Number(usdForecast!.committed) + Number(usdForecast!.avgWeeklyIncome);
    expect(Number(usdForecast!.projected)).toBeCloseTo(expected, 2);
  });
});
