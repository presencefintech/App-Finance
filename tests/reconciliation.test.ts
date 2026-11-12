import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '../src/generated/prisma/enums';
import { createTestDb } from './helpers/db';
import { META, makeActor } from './helpers/fixtures';

type Db = typeof import('../src/server/db').prisma;
let prisma: Db;
let drop: () => Promise<void>;
let rec: typeof import('../src/server/modules/reconciliation/service');
let accounts: typeof import('../src/server/modules/accounts/service');
let incomes: typeof import('../src/server/modules/incomes/service');
let expenses: typeof import('../src/server/modules/expenses/service');
let ledger: typeof import('../src/server/ledger');

let SEC = '';
let ECOLE = '';
const A: Record<string, ReturnType<typeof makeActor>> = {};
const ids: Record<string, string> = {};

async function person(name: string, roles: { entityId: string; role: Role }[]) {
  const u = await prisma.user.create({ data: { email: `${name}@t.local`, fullName: name, passwordHash: 'x', roles: { create: roles } } });
  A[name] = makeActor(u.id, roles);
}
const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const csv = (rows: string[]) => Buffer.from(['date;libellé;débit;crédit;ref', ...rows].join('\n'), 'utf8');
const MAPPING = { hasHeader: true, date: 0, label: 1, debit: 2, credit: 3, reference: 4 };

beforeAll(async () => {
  const db = await createTestDb();
  drop = db.drop;
  prisma = (await import('../src/server/db')).prisma;
  rec = await import('../src/server/modules/reconciliation/service');
  accounts = await import('../src/server/modules/accounts/service');
  incomes = await import('../src/server/modules/incomes/service');
  expenses = await import('../src/server/modules/expenses/service');
  ledger = await import('../src/server/ledger');

  SEC = (await prisma.entity.create({ data: { code: 'SEC', name: 'SEC SARL' } })).id;
  ECOLE = (await prisma.entity.create({ data: { code: 'ECOLE', name: 'École' } })).id;
  await person('ctrl', [{ entityId: SEC, role: 'CONTROLLER' }]);
  await person('ctrl2', [{ entityId: SEC, role: 'CONTROLLER' }]);
  await person('cashier', [{ entityId: SEC, role: 'CASHIER' }]);
  await person('ecoleCtrl', [{ entityId: ECOLE, role: 'CONTROLLER' }]);

  const mk = (name: string, type: 'CASH' | 'BANK', opening: string) =>
    accounts.createAccount(A.ctrl!, { entityId: SEC, type, name, currency: 'USD', openingBalance: opening, openedAt: day(30), ...(type === 'BANK' ? { bankName: 'Rawbank' } : {}) }, META);
  ids.bank = (await mk('Rawbank USD', 'BANK', '1000.00')).id;
  ids.bank2 = (await mk('Equity USD', 'BANK', '1000.00')).id;
  ids.cash = (await mk('Caisse', 'CASH', '50.00')).id;
  ids.catIn = (await prisma.category.create({ data: { entityId: SEC, kind: 'INCOME', name: 'Partenaires' } })).id;
  ids.catOut = (await prisma.category.create({ data: { entityId: SEC, kind: 'EXPENSE', name: 'Fournitures' } })).id;
});

afterAll(async () => {
  await drop?.();
});

const income = (amount: string, date: string, source: string) =>
  incomes.createIncome(A.ctrl!, { entityId: SEC, source, categoryId: ids.catIn!, amount, currency: 'USD', paymentMethod: 'BANK_TRANSFER', accountId: ids.bank!, date }, META);
const expense = (amount: string, date: string, who: string) =>
  expenses.createExpense(A.ctrl!, { entityId: SEC, categoryId: ids.catOut!, beneficiary: who, purpose: 'achat', amount, currency: 'USD', paymentMethod: 'BANK_TRANSFER', accountId: ids.bank!, date }, META);
const balance = async (id: string) => (await ledger.getAccountBalance(prisma, id)).toFixed(2);

let statementId = '';
const line: Record<string, string> = {};

describe('import du relevé', () => {
  let refIncome = '';
  let refDiff = '';

  it('prépare les écritures du grand livre', async () => {
    const inc = await income('500.00', day(5), 'Partenaire X');
    refIncome = inc.reference;
    await expense('120.00', day(4), 'Papeterie');
    await expense('75.00', day(3), 'Fournisseur A');
    await expense('75.00', day(3), 'Fournisseur B');
    await expense('33.00', day(3), 'Écriture absente du relevé');
    const diff = await expense('200.00', day(2), 'Garage');
    refDiff = diff.reference;
    expect(await balance(ids.bank!)).toBe('997.00'); // 1000 + 500 − 120 − 75 − 75 − 33 − 200
  });

  it('refuse : fichier incohérent, ligne invalide, mauvais type de compte, droits insuffisants', async () => {
    const base = { accountId: ids.bank!, fileName: 'r.csv', mapping: MAPPING };
    const ok = csv([`${day(5)};VIR ${refIncome};;500,00;`]);
    await expect(rec.importStatement(A.ctrl!, { ...base, bytes: ok, openingBalance: '1000.00', closingBalance: '1400.00' }, META))
      .rejects.toMatchObject({ code: 'STATEMENT_INCOHERENT' });
    await expect(rec.importStatement(A.ctrl!, { ...base, bytes: csv(['pas-une-date;X;1,00;;']), openingBalance: '1000', closingBalance: '999' }, META))
      .rejects.toMatchObject({ code: 'IMPORT_INVALID', details: [{ row: 2 }] });
    await expect(rec.importStatement(A.ctrl!, { ...base, accountId: ids.cash!, bytes: ok, openingBalance: '1000.00', closingBalance: '1500.00' }, META))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(rec.importStatement(A.cashier!, { ...base, bytes: ok, openingBalance: '1000.00', closingBalance: '1500.00' }, META))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(rec.importStatement(A.ecoleCtrl!, { ...base, bytes: ok, openingBalance: '1000.00', closingBalance: '1500.00' }, META))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('importe le relevé, mémorise le mapping, détecte les doublons, refuse un second import du même fichier', async () => {
    const bytes = csv([
      `${day(5)};VIR RECU ${refIncome} PARTENAIRE;;500,00;`,
      `${day(2)};PAIEMENT PAPETERIE;120,00;;`,
      `${day(3)};PAIEMENT FOURNISSEUR;75,00;;`,
      `${day(3)};PAIEMENT FOURNISSEUR;75,00;;`,
      `${day(3)};FRAIS TENUE DE COMPTE;5,00;;`,
      `${day(2)};REGLEMENT GARAGE ${refDiff};220,00;;`,
    ]);
    const preview = await rec.previewStatement(A.ctrl!, ids.bank!, 'releve.csv', bytes);
    expect(preview.firstRow).toEqual(['date', 'libellé', 'débit', 'crédit', 'ref']);
    expect(preview.savedMapping).toBeNull();

    const res = await rec.importStatement(A.ctrl!, { accountId: ids.bank!, fileName: 'releve.csv', bytes, mapping: MAPPING, openingBalance: '1000.00', closingBalance: '1005.00' }, META);
    expect(res).toMatchObject({ lines: 6, duplicates: 1 });
    statementId = res.id;

    expect((await rec.previewStatement(A.ctrl!, ids.bank!, 'autre.csv', bytes)).savedMapping).toMatchObject({ debit: 2, credit: 3 });
    await expect(rec.importStatement(A.ctrl!, { accountId: ids.bank!, fileName: 'releve.csv', bytes, mapping: MAPPING, openingBalance: '1000.00', closingBalance: '1005.00' }, META))
      .rejects.toMatchObject({ code: 'STATEMENT_ALREADY_IMPORTED' });
  });
});

describe('suggestion et confirmation humaine', () => {
  it('l’auto-match classe chaque cas correctement et ne confirme RIEN tout seul', async () => {
    const r = await rec.autoMatch(A.ctrl!, statementId, META);
    expect(r).toMatchObject({ preselected: 1 });
    const st = await rec.getStatement(A.ctrl!, statementId);
    const byLabel = (needle: string) => [...st.columns.matched, ...st.columns.unrecorded, ...st.columns.amountDifferences].filter((l) => l.label.includes(needle));
    const a = byLabel('PARTENAIRE')[0]!;
    const b = byLabel('PAPETERIE')[0]!;
    const fournisseurs = byLabel('FOURNISSEUR');
    const fee = byLabel('FRAIS')[0]!;
    const garage = byLabel('GARAGE')[0]!;
    Object.assign(line, { a: a.id, b: b.id, c: fournisseurs[0]!.id, d: fournisseurs[1]!.id, fee: fee.id, garage: garage.id });

    expect(a).toMatchObject({ status: 'SUGGESTED', confidence: 100 });
    expect(a.preselectedEntryId).not.toBeNull();
    expect(b).toMatchObject({ status: 'SUGGESTED', confidence: 80, preselectedEntryId: null });
    for (const f of fournisseurs) {
      expect(f.status).toBe('SUGGESTED');
      expect(f.candidates).toHaveLength(2); // ambigu : jamais auto-confirmé
      expect(f.preselectedEntryId).toBeNull();
    }
    expect(fee.status).toBe('UNMATCHED');
    expect(st.columns.amountDifferences.map((x) => x.label)).toEqual([expect.stringContaining('GARAGE')]);
    expect(st.columns.duplicates).toHaveLength(1);
    expect(st.columns.missingFromStatement.map((e) => e.description).join('|')).toContain('Écriture absente du relevé');

    expect(await prisma.bankStatementLine.count({ where: { statementId, matchStatus: 'MATCHED' } })).toBe(0);
  });

  it('seule la confirmation par un utilisateur autorisé rapproche ; une écriture ne sert qu’une fois ; montants égaux exigés', async () => {
    await expect(rec.confirmLine(A.cashier!, statementId, line.a!, undefined, META)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await rec.confirmLine(A.ctrl!, statementId, line.a!, undefined, META); // pré-cochée
    const st0 = await rec.getStatement(A.ctrl!, statementId);
    const a = st0.columns.matched.find((l) => l.id === line.a)!;
    expect(a.status).toBe('MATCHED');
    expect(a.matchedEntry?.amount).toBe('500.00');

    const b = st0.columns.matched.find((l) => l.id === line.b)!;
    await rec.confirmLine(A.ctrl!, statementId, line.b!, b.candidates[0]!.id, META);

    const c = (await rec.getStatement(A.ctrl!, statementId)).columns.matched.find((l) => l.id === line.c)!;
    const [e1, e2] = c.candidates;
    await rec.confirmLine(A.ctrl!, statementId, line.c!, e1!.id, META);
    await expect(rec.confirmLine(A.ctrl!, statementId, line.d!, e1!.id, META)).rejects.toMatchObject({ code: 'ENTRY_UNAVAILABLE' });
    await rec.confirmLine(A.ctrl!, statementId, line.d!, e2!.id, META);

    const garageEntry = (await rec.getStatement(A.ctrl!, statementId)).columns.amountDifferences[0]!.amountDiffEntry!;
    await expect(rec.confirmLine(A.ctrl!, statementId, line.garage!, garageEntry.id, META)).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' });
  });

  it('« créer l’opération » depuis une ligne non enregistrée : frais bancaire créé, ligne liée, solde mis à jour', async () => {
    const before = await balance(ids.bank!);
    const res = await rec.createFromLine(A.ctrl!, statementId, line.fee!, {}, META);
    expect(res.reference).toMatch(/^SEC-FRB-/);
    expect(Number(before) - Number(await balance(ids.bank!))).toBe(5);
    const row = await prisma.bankStatementLine.findUniqueOrThrow({ where: { id: line.fee! } });
    expect(row.matchStatus).toBe('CREATED');
    expect(row.matchedEntryId).not.toBeNull();
    expect(await prisma.expense.count({ where: { reference: res.reference } })).toBe(1);
    await expect(rec.createFromLine(A.ctrl!, statementId, line.fee!, {}, META)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('on peut annuler un rapprochement tant que le relevé est en cours, et ignorer une ligne avec un motif', async () => {
    await rec.unmatchLine(A.ctrl!, statementId, line.b!, META);
    expect((await prisma.bankStatementLine.findUniqueOrThrow({ where: { id: line.b! } })).matchStatus).toBe('UNMATCHED');
    await rec.autoMatch(A.ctrl!, statementId, META);
    const b = (await rec.getStatement(A.ctrl!, statementId)).columns.matched.find((l) => l.id === line.b)!;
    await rec.confirmLine(A.ctrl!, statementId, line.b!, b.candidates[0]!.id, META);
    await expect(rec.ignoreLine(A.ctrl!, statementId, line.garage!, '', META)).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });
});

describe('état de rapprochement, soumission et validation', () => {
  it('chiffrage : solde relevé vs solde comptable, suspens, écart final', async () => {
    const r = (await rec.getStatement(A.ctrl!, statementId)).reconciliation;
    // grand livre = 1000 + 500 − 120 − 75 − 75 − 33 − 200 − 5 = 992 ; relevé = 1005
    expect(r).toMatchObject({ statementClosing: '1005.00', ledgerBalance: '992.00', balanced: true, difference: '0.00' });
    expect(r.outstandingEntries).toBe('-233.00'); // 33 (absente du relevé) + 200 (montant différent)
    expect(r.unrecordedStatementLines).toBe('-220.00'); // la ligne GARAGE à 220
  });

  it('soumission : toute suggestion doit être tranchée ; validation par une autre personne, avec step-up', async () => {
    await expect(rec.validateStatement(A.ctrl2!, statementId, undefined, META)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await rec.submitStatement(A.ctrl!, statementId, META);
    await expect(rec.autoMatch(A.ctrl!, statementId, META)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(rec.confirmLine(A.ctrl!, statementId, line.garage!, undefined, META)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(rec.validateStatement(A.ctrl!, statementId, undefined, META)).rejects.toMatchObject({ code: 'SEPARATION_OF_DUTIES' });
    const noStepUp = makeActor(A.ctrl2!.id, A.ctrl2!.roles, { stepUp: false });
    await expect(rec.validateStatement(noStepUp, statementId, undefined, META)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    const done = await rec.validateStatement(A.ctrl2!, statementId, undefined, META);
    expect(done).toMatchObject({ status: 'VALIDATED', difference: '0.00' });
    expect(await prisma.auditLog.count({ where: { action: 'reconciliation.validate' } })).toBe(1);
  });

  it('soumettre avec une suggestion non tranchée est refusé', async () => {
    const bytes = csv([`${day(1)};VIR INCONNU;;10,00;`]);
    await income('10.00', day(1), 'Don');
    const imp = await rec.importStatement(A.ctrl!, { accountId: ids.bank2!, fileName: 's2.csv', bytes, mapping: MAPPING, openingBalance: '1000.00', closingBalance: '1010.00' }, META);
    // bank2 n'a aucune écriture à suggérer (le don est sur ids.bank) : on force une suggestion en créant la même écriture sur bank2.
    await incomes.createIncome(A.ctrl!, { entityId: SEC, source: 'Don', categoryId: ids.catIn!, amount: '10.00', currency: 'USD', paymentMethod: 'BANK_TRANSFER', accountId: ids.bank2!, date: day(1) }, META);
    await rec.autoMatch(A.ctrl!, imp.id, META);
    await expect(rec.submitStatement(A.ctrl!, imp.id, META)).rejects.toMatchObject({ code: 'LINES_PENDING' });
  });

  it('écart non nul : la validation exige une note d’acceptation', async () => {
    // Le solde comptable d'ouverture (1000) diffère du relevé (900) ⇒ écart de 100.
    const acc = (await accounts.createAccount(A.ctrl!, { entityId: SEC, type: 'BANK', name: 'Écart USD', currency: 'USD', bankName: 'BCDC', openingBalance: '1000.00', openedAt: day(30) }, META)).id;
    const bytes = csv([`${day(1)};VIR RECU;;50,00;`]);
    const imp = await rec.importStatement(A.ctrl!, { accountId: acc, fileName: 's3.csv', bytes, mapping: MAPPING, openingBalance: '900.00', closingBalance: '950.00' }, META);
    const r = (await rec.getStatement(A.ctrl!, imp.id)).reconciliation;
    expect(r.balanced).toBe(false);
    await rec.submitStatement(A.ctrl!, imp.id, META);
    await expect(rec.validateStatement(A.ctrl2!, imp.id, undefined, META)).rejects.toMatchObject({ code: 'RECONCILIATION_UNBALANCED' });
    const ok = await rec.validateStatement(A.ctrl2!, imp.id, 'Écart d’ouverture expliqué par l’ancien exercice', META);
    expect(ok.status).toBe('VALIDATED');
    expect((await prisma.bankStatement.findUniqueOrThrow({ where: { id: imp.id } })).validationNote).toContain('ancien exercice');
  });

  it('un relevé n’est jamais supprimable', async () => {
    await expect(prisma.$executeRaw`DELETE FROM "BankStatement" WHERE "id" = ${statementId}`).rejects.toThrow(/interdit/);
  });
});
