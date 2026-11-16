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
let attachments: typeof import('../src/server/modules/attachments/service');
let evidence: typeof import('../src/server/modules/attachments/evidence');
let ledger: typeof import('../src/server/ledger');

let SEC = '';
let ECOLE = '';
const A: Record<string, ReturnType<typeof makeActor>> = {};
const ids: Record<string, string> = {};

async function person(name: string, roles: { entityId: string; role: Role }[], opts: { stepUp?: boolean } = {}) {
  const u = await prisma.user.create({ data: { email: `${name}@t.local`, fullName: name, passwordHash: 'x', roles: { create: roles } } });
  A[name] = makeActor(u.id, roles, opts);
}
const bal = async (id: string) => (await ledger.getAccountBalance(prisma, id)).toFixed(2);
const PDF = Buffer.from('%PDF-1.4\n% justificatif de test\n');

/** Dépose un justificatif « en attente » (avant l'opération) pour l'entité donnée. */
async function draft(actor: string, entityId = SEC) {
  const a = await attachments.uploadAttachment(
    A[actor]!, { target: { type: 'draft', entityId }, kind: 'INVOICE', fileName: 'facture.pdf', declaredType: 'application/pdf', bytes: PDF }, META,
  );
  return a.id;
}
const income = (amount: string, extra: Partial<Parameters<typeof incomes.createIncome>[1]> = {}) => ({
  entityId: SEC, source: 'Client', categoryId: ids.catIncome!, amount, currency: 'USD' as const,
  paymentMethod: 'CASH' as const, accountId: ids.cash!, ...extra,
});
const expense = (amount: string, extra: Partial<Parameters<typeof expenses.createExpense>[1]> = {}) => ({
  entityId: SEC, categoryId: ids.catExpense!, beneficiary: 'Fournisseur', purpose: 'Achat', amount, currency: 'USD' as const,
  paymentMethod: 'CASH' as const, accountId: ids.cash!, ...extra,
});

beforeAll(async () => {
  const db = await createTestDb();
  drop = db.drop;
  prisma = (await import('../src/server/db')).prisma;
  accounts = await import('../src/server/modules/accounts/service');
  incomes = await import('../src/server/modules/incomes/service');
  expenses = await import('../src/server/modules/expenses/service');
  transfers = await import('../src/server/modules/transfers/service');
  attachments = await import('../src/server/modules/attachments/service');
  evidence = await import('../src/server/modules/attachments/evidence');
  ledger = await import('../src/server/ledger');

  SEC = (await prisma.entity.create({ data: { code: 'SEC', prefix: 'SEC', name: 'SEC SARL' } })).id;
  ECOLE = (await prisma.entity.create({ data: { code: 'ECOLE', prefix: 'ECO', name: 'École' } })).id;
  await person('controller', [{ entityId: SEC, role: 'CONTROLLER' }]);
  await person('cashier', [{ entityId: SEC, role: 'CASHIER' }]);
  await person('cashier2', [{ entityId: SEC, role: 'CASHIER' }]);
  await person('ecoleCashier', [{ entityId: ECOLE, role: 'CASHIER' }]);
  await person('director', [{ entityId: SEC, role: 'DIRECTOR' }]);
  await person('directorNoStepUp', [{ entityId: SEC, role: 'DIRECTOR' }], { stepUp: false });

  const mk = (entityId: string, type: 'CASH' | 'BANK', name: string, currency: 'USD' | 'CDF', opening?: string) =>
    accounts.createAccount(A.controller!, { entityId, type, name, currency, openingBalance: opening, ...(type === 'BANK' ? { bankName: 'Rawbank' } : {}) }, META);
  ids.cash = (await mk(SEC, 'CASH', 'Caisse', 'USD', '10000.00')).id;
  ids.cash2 = (await mk(SEC, 'CASH', 'Caisse 2', 'USD')).id;
  ids.cashCdf = (await mk(SEC, 'CASH', 'Caisse CDF', 'CDF', '5000000.00')).id;
  ids.bank = (await mk(SEC, 'BANK', 'Rawbank USD', 'USD', '5000.00')).id;
  ids.catIncome = (await prisma.category.create({ data: { entityId: SEC, kind: 'INCOME', name: 'Partenaires' } })).id;
  ids.catExpense = (await prisma.category.create({ data: { entityId: SEC, kind: 'EXPENSE', name: 'Fournitures' } })).id;
});

afterAll(async () => {
  await drop?.();
});

describe('seuil de justificatif obligatoire', () => {
  it('sans seuil configuré, le justificatif reste facultatif', async () => {
    const r = await incomes.createIncome(A.cashier!, income('9000.00'), META);
    expect(r.reference).toMatch(/^SEC-REC-/);
  });

  it('seul un gestionnaire avec 2FA récente peut fixer un seuil, et c’est tracé dans l’audit', async () => {
    await expect(evidence.setEvidenceThreshold(A.cashier!, { entityId: SEC, currency: 'USD', minAmount: '500.00' }, META))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(evidence.setEvidenceThreshold(A.directorNoStepUp!, { entityId: SEC, currency: 'USD', minAmount: '500.00' }, META))
      .rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await evidence.setEvidenceThreshold(A.director!, { entityId: SEC, currency: 'USD', minAmount: '500.00' }, META);
    expect(await prisma.auditLog.count({ where: { action: 'settings.evidence-threshold' } })).toBe(1);
    const list = await evidence.listEvidenceThresholds(A.cashier!, SEC);
    expect(list).toEqual([
      { entityId: SEC, currency: 'USD', minAmount: '500.00' },
      { entityId: SEC, currency: 'CDF', minAmount: null },
    ]);
  });

  it('une entité ne peut pas lire ni fixer les seuils d’une autre', async () => {
    await expect(evidence.listEvidenceThresholds(A.ecoleCashier!, SEC)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(evidence.setEvidenceThreshold(A.director!, { entityId: ECOLE, currency: 'USD', minAmount: '1.00' }, META))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('sous le seuil : pas de justificatif nécessaire ; au seuil ou au-dessus : refus et aucune écriture', async () => {
    await incomes.createIncome(A.cashier!, income('499.99'), META);
    const before = await bal(ids.cash!);
    const count = await prisma.financialTransaction.count();

    await expect(incomes.createIncome(A.cashier!, income('500.00'), META)).rejects.toMatchObject({ code: 'EVIDENCE_REQUIRED', httpStatus: 422 });
    await expect(expenses.createExpense(A.cashier!, expense('750.00'), META)).rejects.toMatchObject({ code: 'EVIDENCE_REQUIRED' });

    expect(await bal(ids.cash!)).toBe(before);
    expect(await prisma.financialTransaction.count()).toBe(count);
  });

  it('le seuil d’une devise ne s’applique pas à l’autre (pas de conversion)', async () => {
    const r = await incomes.createIncome(A.cashier!, income('9000000.00', { currency: 'CDF', accountId: ids.cashCdf! }), META);
    expect(r.currency).toBe('CDF');
  });

  it('avec un justificatif déposé au préalable : recette acceptée et pièce liée à l’opération', async () => {
    const fileId = await draft('cashier');
    const r = await incomes.createIncome(A.cashier!, income('600.00', { attachmentIds: [fileId] }), META);

    const tx = await prisma.financialTransaction.findFirstOrThrow({ where: { reference: r.reference } });
    const att = await prisma.attachment.findUniqueOrThrow({ where: { id: fileId } });
    expect(att.txId).toBe(tx.id);
    expect(att.kind).toBe('INVOICE');
    const listed = await attachments.listForTransaction(A.controller!, tx.id);
    expect(listed.map((a) => a.id)).toEqual([fileId]);
    expect(await prisma.auditLog.count({ where: { action: 'attachment.link', entityId: fileId } })).toBe(1);
  });

  it('même règle pour une dépense', async () => {
    const fileId = await draft('cashier');
    const before = await bal(ids.cash!);
    const r = await expenses.createExpense(A.cashier!, expense('800.00', { attachmentIds: [fileId] }), META);
    expect(r.amount).toBe('800.00');
    expect(await bal(ids.cash!)).toBe((Number(before) - 800).toFixed(2));
  });

  it('un justificatif ne sert qu’une fois', async () => {
    const fileId = await draft('cashier');
    await incomes.createIncome(A.cashier!, income('700.00', { attachmentIds: [fileId] }), META);
    const before = await bal(ids.cash!);
    await expect(incomes.createIncome(A.cashier!, income('700.00', { attachmentIds: [fileId] }), META))
      .rejects.toMatchObject({ code: 'INVALID_ATTACHMENT' });
    expect(await bal(ids.cash!)).toBe(before); // la recette a été annulée avec la liaison
  });

  it('on ne peut lier ni la pièce d’un autre utilisateur, ni celle d’une autre entité, ni un identifiant inventé', async () => {
    const theirs = await draft('cashier2');
    const otherEntity = await draft('ecoleCashier', ECOLE);
    for (const attachmentIds of [[theirs], [otherEntity], ['inexistant']]) {
      await expect(incomes.createIncome(A.cashier!, income('900.00', { attachmentIds }), META)).rejects.toMatchObject({ code: 'INVALID_ATTACHMENT' });
    }
    // Les pièces refusées restent en attente, intactes.
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: theirs } })).txId).toBeNull();
  });

  it('une pièce en attente n’est visible que par celui qui l’a déposée', async () => {
    const fileId = await draft('cashier');
    await expect(attachments.getAttachmentUrl(A.cashier!, fileId, META)).resolves.toMatchObject({ url: expect.stringContaining(fileId) });
    await expect(attachments.getAttachmentUrl(A.cashier2!, fileId, META)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(attachments.getAttachmentUrl(A.ecoleCashier!, fileId, META)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('le dépôt préalable exige le droit de saisir des opérations dans l’entité', async () => {
    await expect(draft('director')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(draft('ecoleCashier', SEC)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('les transferts et l’import CSV de totaux ne demandent pas de justificatif', async () => {
    await expect(transfers.depositToBank(A.cashier!, { cashAccountId: ids.cash!, bankAccountId: ids.bank!, amount: '2000.00' }, META)).resolves.toBeDefined();
    const r = await incomes.importIncomesCsv(
      A.controller!, { entityId: SEC, accountId: ids.cash!, categoryId: ids.catIncome!, csv: 'date;rubrique;montant;devise\n2026-11-10;Frais;1500.00;USD' }, META,
    );
    expect(r.imported).toBe(1);
  });

  it('le comptage des justificatifs ignore les scans signés et reste cloisonné par entité', async () => {
    const fileId = await draft('cashier');
    const withFile = await incomes.createIncome(A.cashier!, income('650.00', { attachmentIds: [fileId] }), META);
    const without = await incomes.createIncome(A.cashier!, income('10.00'), META);
    const txId = (await prisma.financialTransaction.findFirstOrThrow({ where: { reference: without.reference } })).id;
    await attachments.uploadAttachment(
      A.cashier!, { target: { type: 'transaction', id: txId }, kind: 'SIGNED_REGISTER', fileName: 'scan.pdf', declaredType: 'application/pdf', bytes: PDF }, META,
    );

    const counts = await attachments.evidenceCountsByReference(A.controller!, SEC, [withFile.reference, without.reference]);
    expect(counts.get(withFile.reference)).toBe(1);
    expect(counts.get(without.reference)).toBe(0); // le scan signé n'est pas un justificatif
    expect((await attachments.evidenceCountsByReference(A.ecoleCashier!, SEC, [withFile.reference])).size).toBe(0);
  });

  it('retirer le seuil rend le justificatif de nouveau facultatif', async () => {
    await evidence.setEvidenceThreshold(A.director!, { entityId: SEC, currency: 'USD', minAmount: null }, META);
    await expect(incomes.createIncome(A.cashier!, income('5000.00'), META)).resolves.toBeDefined();
    expect((await evidence.listEvidenceThresholds(A.director!, SEC))[0]!.minAmount).toBeNull();
  });
});
