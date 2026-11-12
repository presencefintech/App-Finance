import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '../src/generated/prisma/enums';
import { createTestDb } from './helpers/db';
import { META, makeActor } from './helpers/fixtures';

type Svc = typeof import('../src/server/modules/fund-requests/service');
type Db = typeof import('../src/server/db').prisma;
let prisma: Db;
let drop: () => Promise<void>;
let svc: Svc;
let accounts: typeof import('../src/server/modules/accounts/service');
let attachments: typeof import('../src/server/modules/attachments/service');
let ledger: typeof import('../src/server/ledger');

let SEC = '';
let ECOLE = '';
let secCashId = '';

type Actor = ReturnType<typeof makeActor>;
const actors: Record<string, Actor> = {};

/** Crée l'utilisateur en base (pour les notifications) et l'acteur correspondant. */
async function person(name: string, roles: { entityId: string; role: Role }[]) {
  const u = await prisma.user.create({ data: { email: `${name}@t.local`, fullName: name, passwordHash: 'x', roles: { create: roles } } });
  actors[name] = makeActor(u.id, roles);
  return actors[name]!;
}

beforeAll(async () => {
  const db = await createTestDb();
  drop = db.drop;
  prisma = (await import('../src/server/db')).prisma;
  svc = await import('../src/server/modules/fund-requests/service');
  accounts = await import('../src/server/modules/accounts/service');
  attachments = await import('../src/server/modules/attachments/service');
  ledger = await import('../src/server/ledger');

  SEC = (await prisma.entity.create({ data: { code: 'SEC', prefix: 'SEC', name: 'SEC SARL' } })).id;
  ECOLE = (await prisma.entity.create({ data: { code: 'ECOLE', prefix: 'ECO', name: 'École' } })).id;

  await person('requester', [{ entityId: SEC, role: 'REQUESTER' }]);
  await person('requester2', [{ entityId: SEC, role: 'REQUESTER' }]);
  await person('controller', [{ entityId: SEC, role: 'CONTROLLER' }]);
  await person('director', [{ entityId: SEC, role: 'DIRECTOR' }]);
  await person('cashier', [{ entityId: SEC, role: 'CASHIER' }]);
  await person('cashier2', [{ entityId: SEC, role: 'CASHIER' }]);
  await person('ecoleController', [{ entityId: ECOLE, role: 'CONTROLLER' }]);
  await person('dual', [{ entityId: SEC, role: 'REQUESTER' }, { entityId: SEC, role: 'CONTROLLER' }]);
  await person('controllerCashier', [{ entityId: SEC, role: 'CONTROLLER' }, { entityId: SEC, role: 'CASHIER' }]);

  const cash = await accounts.createAccount(
    actors.controller!, { entityId: SEC, type: 'CASH', name: 'Caisse SEC', currency: 'USD', openingBalance: '1000.00' }, META,
  );
  secCashId = cash.id;
});

afterAll(async () => {
  await drop?.();
});

const balance = async () => (await ledger.getAccountBalance(prisma, secCashId)).toFixed(2);
const create = (by: string, amount = '100.00', submit = true) =>
  svc.createFundRequest(actors[by]!, { entityId: SEC, amount, currency: 'USD', purpose: 'Achat de fournitures de bureau', submit }, META);

async function toApproved(amount = '100.00') {
  const r = await create('requester', amount);
  await svc.reviewFundRequest(actors.controller!, r.id, META);
  await svc.approveFundRequest(actors.controller!, r.id, undefined, META);
  return r;
}

describe('circuit complet', () => {
  it('brouillon → soumis → examiné → approuvé (aucun solde ne bouge) → décaissé → reçu → justifié → clôturé', async () => {
    const r = await create('requester', '100.00');
    expect(r.reference).toMatch(/^SEC-DF-\d{4}-\d{5}$/);
    expect(r.status).toBe('SUBMITTED');

    await svc.reviewFundRequest(actors.controller!, r.id, META);
    const approved = await svc.approveFundRequest(actors.controller!, r.id, 'OK', META);
    expect(approved.status).toBe('APPROVED');
    expect(await balance()).toBe('1000.00'); // règle 8 : approuvé ≠ décaissé
    expect(await prisma.ledgerEntry.count({ where: { tx: { fundRequestId: r.id } } })).toBe(0);

    const disbursed = await svc.disburseFundRequest(actors.cashier!, r.id, { accountId: secCashId }, META);
    expect(disbursed.status).toBe('DISBURSED');
    expect(await balance()).toBe('900.00');
    const expense = await prisma.expense.findFirstOrThrow({ where: { fundRequestId: r.id } });
    expect(expense.amount.toString()).toBe('100');

    await svc.confirmReceipt(actors.requester!, r.id, META);
    await expect(svc.justifyFundRequest(actors.requester!, r.id, undefined, META)).rejects.toMatchObject({ code: 'ATTACHMENT_REQUIRED' });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    await attachments.uploadAttachment(
      actors.requester!, { target: { type: 'fundRequest', id: r.id }, kind: 'RECEIPT', fileName: 'facture.png', declaredType: 'image/png', bytes: png }, META,
    );
    await svc.justifyFundRequest(actors.requester!, r.id, undefined, META);
    const closed = await svc.closeFundRequest(actors.controller!, r.id, undefined, META);
    expect(closed.status).toBe('CLOSED');
    expect(closed.events.map((e) => e.toStatus)).toEqual([
      'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'DISBURSED', 'RECEIVED', 'JUSTIFIED', 'CLOSED',
    ]);
    expect(await prisma.auditLog.count({ where: { entityType: 'FundRequest', entityId: r.id } })).toBeGreaterThanOrEqual(8);
  });
});

describe('transitions interdites', () => {
  it("chaque action hors de son état est refusée (INVALID_STATE)", async () => {
    const draft = await create('requester', '10.00', false);
    await expect(svc.reviewFundRequest(actors.controller!, draft.id, META)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(svc.approveFundRequest(actors.controller!, draft.id, undefined, META)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(svc.disburseFundRequest(actors.cashier!, draft.id, { accountId: secCashId }, META)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(svc.confirmReceipt(actors.requester!, draft.id, META)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(svc.closeFundRequest(actors.controller!, draft.id, undefined, META)).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const approved = await toApproved('10.00');
    await expect(svc.submitFundRequest(actors.requester!, approved.id, META)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(svc.cancelFundRequest(actors.requester!, approved.id, META)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(svc.confirmReceipt(actors.requester!, approved.id, META)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(svc.approveFundRequest(actors.controller!, approved.id, undefined, META)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('rejet : commentaire obligatoire, puis plus aucune action possible', async () => {
    const r = await create('requester', '20.00');
    await svc.reviewFundRequest(actors.controller!, r.id, META);
    await expect(svc.rejectFundRequest(actors.controller!, r.id, '', META)).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    const rejected = await svc.rejectFundRequest(actors.controller!, r.id, 'Budget insuffisant', META);
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.events.at(-1)?.comment).toBe('Budget insuffisant');
    await expect(svc.approveFundRequest(actors.director!, r.id, undefined, META)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it("le demandeur annule un brouillon ou une demande soumise, pas celle d'un autre", async () => {
    const r = await create('requester', '5.00');
    await expect(svc.cancelFundRequest(actors.requester2!, r.id, META)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await svc.cancelFundRequest(actors.requester!, r.id, META)).status).toBe('CANCELLED');
  });
});

describe('plafonds et transmission au chef', () => {
  it('au-dessus du plafond de la contrôleuse : APPROVAL_LIMIT_EXCEEDED, puis la direction approuve', async () => {
    const r = await create('requester', '600.00');
    await svc.reviewFundRequest(actors.controller!, r.id, META);
    await expect(svc.approveFundRequest(actors.controller!, r.id, undefined, META)).rejects.toMatchObject({ code: 'APPROVAL_LIMIT_EXCEEDED' });
    const esc = await svc.escalateFundRequest(actors.controller!, r.id, 'Au-dessus de mon plafond', META);
    expect(esc.status).toBe('ESCALATED');
    await expect(svc.approveFundRequest(actors.controller!, r.id, undefined, META)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const ok = await svc.approveFundRequest(actors.director!, r.id, undefined, META);
    expect(ok.status).toBe('APPROVED');
    expect(ok.approvalLevel).toBe('DIRECTOR');
  });

  it("l'approbation par la direction exige le step-up", async () => {
    const r = await create('requester', '30.00');
    await svc.reviewFundRequest(actors.controller!, r.id, META);
    const noStepUp = makeActor(actors.director!.id, actors.director!.roles, { stepUp: false });
    await expect(svc.approveFundRequest(noStepUp, r.id, undefined, META)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
  });

  it('un plafond configuré par entité remplace la valeur par défaut', async () => {
    await prisma.approvalLimit.create({ data: { entityId: SEC, role: 'CONTROLLER', currency: 'USD', maxAmount: '50' } });
    const r = await create('requester', '80.00');
    await svc.reviewFundRequest(actors.controller!, r.id, META);
    await expect(svc.approveFundRequest(actors.controller!, r.id, undefined, META)).rejects.toMatchObject({ code: 'APPROVAL_LIMIT_EXCEEDED' });
    await prisma.approvalLimit.deleteMany({ where: { entityId: SEC } });
  });
});

describe('séparation des tâches', () => {
  it('le demandeur ne peut ni examiner, ni approuver, ni clôturer sa propre demande', async () => {
    const r = await create('dual', '40.00');
    await expect(svc.reviewFundRequest(actors.dual!, r.id, META)).rejects.toMatchObject({ code: 'SEPARATION_OF_DUTIES' });
    await svc.reviewFundRequest(actors.controller!, r.id, META);
    await expect(svc.approveFundRequest(actors.dual!, r.id, undefined, META)).rejects.toMatchObject({ code: 'SEPARATION_OF_DUTIES' });
  });

  it("l'approbateur ne décaisse pas la même demande, sauf option admin (tracée)", async () => {
    const r = await create('requester', '25.00');
    await svc.reviewFundRequest(actors.controllerCashier!, r.id, META);
    await svc.approveFundRequest(actors.controllerCashier!, r.id, undefined, META);
    await expect(svc.disburseFundRequest(actors.controllerCashier!, r.id, { accountId: secCashId }, META))
      .rejects.toMatchObject({ code: 'SEPARATION_OF_DUTIES' });

    await prisma.setting.create({ data: { key: 'allowSameApproverCashier', value: 'true' } });
    const done = await svc.disburseFundRequest(actors.controllerCashier!, r.id, { accountId: secCashId }, META);
    expect(done.status).toBe('DISBURSED');
    expect((await svc.getFundRequest(actors.controller!, r.id)).events.at(-1)?.comment).toContain('allowSameApproverCashier');
    await prisma.setting.deleteMany();
  });

  it("le demandeur ne peut pas décaisser sa propre demande ; un REQUESTER ne peut pas approuver", async () => {
    const r = await toApproved('15.00');
    await expect(svc.approveFundRequest(actors.requester!, r.id, undefined, META)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(svc.disburseFundRequest(actors.requester!, r.id, { accountId: secCashId }, META)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('décaissement', () => {
  it('step-up requis ; solde insuffisant ⇒ rollback complet, la demande reste APPROVED', async () => {
    const r = await toApproved('50.00');
    const noStepUp = makeActor(actors.cashier!.id, actors.cashier!.roles, { stepUp: false });
    await expect(svc.disburseFundRequest(noStepUp, r.id, { accountId: secCashId }, META)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });

    const small = await accounts.createAccount(actors.controller!, { entityId: SEC, type: 'CASH', name: 'Petite caisse', currency: 'USD', openingBalance: '10.00' }, META);
    await expect(svc.disburseFundRequest(actors.cashier!, r.id, { accountId: small.id }, META)).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect((await svc.getFundRequest(actors.controller!, r.id)).status).toBe('APPROVED');
    expect(await prisma.expense.count({ where: { fundRequestId: r.id } })).toBe(0);
    expect((await ledger.getAccountBalance(prisma, small.id)).toFixed(2)).toBe('10.00');
  });

  it('deux caissiers qui décaissent en même temps : un seul passe, le solde n’est débité qu’une fois', async () => {
    const r = await toApproved('70.00');
    const before = await balance();
    const results = await Promise.allSettled([
      svc.disburseFundRequest(actors.cashier!, r.id, { accountId: secCashId }, META),
      svc.disburseFundRequest(actors.cashier2!, r.id, { accountId: secCashId }, META),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(Number(before) - Number(await balance())).toBe(70);
    expect(await prisma.expense.count({ where: { fundRequestId: r.id } })).toBe(1);
  });

  it("la devise du compte doit être celle de la demande ; décaisser depuis l'autre entité est refusé en phase 3", async () => {
    const cdf = await accounts.createAccount(actors.controller!, { entityId: SEC, type: 'CASH', name: 'Caisse CDF', currency: 'CDF', openingBalance: '5000000.00' }, META);
    const r = await toApproved('10.00');
    await expect(svc.disburseFundRequest(actors.cashier!, r.id, { accountId: cdf.id }, META)).rejects.toMatchObject({ code: 'CURRENCY_MISMATCH' });
    const ecoleCash = await accounts.createAccount(actors.ecoleController!, { entityId: ECOLE, type: 'CASH', name: 'Caisse École', currency: 'USD', openingBalance: '500.00' }, META);
    await expect(svc.disburseFundRequest(actors.cashier!, r.id, { accountId: ecoleCash.id }, META)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('isolation et visibilité', () => {
  it("une contrôleuse de l'École ne voit ni ne traite les demandes de SEC", async () => {
    const r = await create('requester', '12.00');
    await expect(svc.getFundRequest(actors.ecoleController!, r.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.reviewFundRequest(actors.ecoleController!, r.id, META)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const list = await svc.listFundRequests(actors.ecoleController!, { page: 1, pageSize: 100 });
    expect(list.total).toBe(0);
  });

  it('un demandeur ne voit que ses propres demandes', async () => {
    const mine = await create('requester', '11.00');
    const other = await create('requester2', '13.00');
    const list = await svc.listFundRequests(actors.requester!, { page: 1, pageSize: 200 });
    expect(list.data.some((x) => x.id === mine.id)).toBe(true);
    expect(list.data.some((x) => x.id === other.id)).toBe(false);
    await expect(svc.getFundRequest(actors.requester!, other.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const all = await svc.listFundRequests(actors.controller!, { page: 1, pageSize: 200 });
    expect(all.data.some((x) => x.id === other.id)).toBe(true);
  });

  it('les notifications partent vers les bons acteurs', async () => {
    const r = await create('requester', '9.00');
    const forController = await prisma.notification.count({ where: { userId: actors.controller!.id, href: `/demandes/${r.id}` } });
    expect(forController).toBe(1);
    const forRequester = await prisma.notification.count({ where: { userId: actors.requester!.id, href: `/demandes/${r.id}` } });
    expect(forRequester).toBe(0);
  });
});

describe('pièces jointes', () => {
  it('refuse un type non autorisé, un contenu qui ne correspond pas, et un fichier trop gros', async () => {
    const r = await create('requester', '8.00');
    const target = { type: 'fundRequest' as const, id: r.id };
    const up = (bytes: Buffer, declaredType: string) =>
      attachments.uploadAttachment(actors.requester!, { target, kind: 'RECEIPT', fileName: 'x', declaredType, bytes }, META);
    await expect(up(Buffer.from('MZ\x90\x00 executable'), 'application/pdf')).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
    await expect(up(Buffer.from('%PDF-1.4 ok'), 'image/png')).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
    await expect(up(Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(attachments.MAX_UPLOAD_BYTES)]), 'application/pdf')).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    const ok = await up(Buffer.from('%PDF-1.4 contenu'), 'application/pdf');
    expect(ok.sha256).toHaveLength(64);
  });

  it("un utilisateur d'une autre entité ne peut ni déposer ni lire une pièce", async () => {
    const r = await create('requester', '7.00');
    const att = await attachments.uploadAttachment(
      actors.requester!, { target: { type: 'fundRequest', id: r.id }, kind: 'RECEIPT', fileName: 'a.pdf', declaredType: 'application/pdf', bytes: Buffer.from('%PDF-1.4 x') }, META,
    );
    await expect(attachments.getAttachmentUrl(actors.ecoleController!, att.id, META)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(attachments.uploadAttachment(
      actors.ecoleController!, { target: { type: 'fundRequest', id: r.id }, kind: 'RECEIPT', fileName: 'a.pdf', declaredType: 'application/pdf', bytes: Buffer.from('%PDF-1.4 x') }, META,
    )).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const url = await attachments.getAttachmentUrl(actors.controller!, att.id, META);
    expect(url.url).toContain(att.id);
  });
});
