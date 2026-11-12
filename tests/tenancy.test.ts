import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '../src/generated/prisma/enums';
import { createTestDb, type TestOrg } from './helpers/db';
import { META, makeActor } from './helpers/fixtures';

type Db = typeof import('../src/server/db');
let db: Db;
let prisma: Db['prisma'];
let admin: Awaited<ReturnType<typeof createTestDb>>['admin'];
let drop: () => Promise<void>;
let A: TestOrg;
let B: TestOrg;
let runInOrg: typeof import('../src/server/tenant').runInOrg;
let accounts: typeof import('../src/server/modules/accounts/service');
let incomes: typeof import('../src/server/modules/incomes/service');
let users: typeof import('../src/server/modules/users/service');
let audit: typeof import('../src/server/modules/audit/service');
let advances: typeof import('../src/server/modules/advances/service');
let transfers: typeof import('../src/server/modules/transfers/service');
let platform: typeof import('../src/server/modules/platform/service');
let settings: typeof import('../src/server/modules/settings/service');
let settingsReader: typeof import('../src/server/settings');

const ids = { entA: '', entB: '', accA: '', accB: '', cashA2: '', catInA: '', catInB: '' };
const actors: Record<string, ReturnType<typeof makeActor>> = {};

const inOrg = <T>(org: TestOrg, fn: () => Promise<T>) => runInOrg(org.id, fn);
const asOrg = (org: TestOrg, id: string, roles: { entityId: string; role: Role }[]) => ({ ...makeActor(id, roles), organizationId: org.id });

async function bootstrap(org: TestOrg, tag: string) {
  return inOrg(org, async () => {
    const ent = await prisma.entity.create({ data: { code: 'SEC', prefix: 'SEC', name: `Entité ${tag}` } }); // MÊMES code et préfixe dans les deux organisations
    const mkUser = async (name: string, role: Role) => {
      const u = await prisma.user.create({ data: { email: `${name}.${tag}@t.local`, fullName: name, passwordHash: 'x', roles: { create: [{ entityId: ent.id, role }] } } });
      actors[`${name}${tag}`] = asOrg(org, u.id, [{ entityId: ent.id, role }]);
    };
    await mkUser('ctrl', 'CONTROLLER');
    await mkUser('admin', 'ADMIN');
    const acc = await accounts.createAccount(actors[`ctrl${tag}`]!, { entityId: ent.id, type: 'CASH', name: `Caisse ${tag}`, currency: 'USD', openingBalance: '100.00' }, META);
    const acc2 = await accounts.createAccount(actors[`ctrl${tag}`]!, { entityId: ent.id, type: 'CASH', name: `Caisse bis ${tag}`, currency: 'USD', openingBalance: '50.00' }, META);
    const cat = await prisma.category.create({ data: { entityId: ent.id, kind: 'INCOME', name: 'Partenaires' } });
    return { entityId: ent.id, accountId: acc.id, account2Id: acc2.id, categoryId: cat.id };
  });
}

beforeAll(async () => {
  const t = await createTestDb({ orgs: ['Organisation A', 'Organisation B'] });
  drop = t.drop;
  admin = t.admin;
  [A, B] = t.orgs as [TestOrg, TestOrg];
  db = await import('../src/server/db');
  prisma = db.prisma;
  ({ runInOrg } = await import('../src/server/tenant'));
  accounts = await import('../src/server/modules/accounts/service');
  incomes = await import('../src/server/modules/incomes/service');
  users = await import('../src/server/modules/users/service');
  audit = await import('../src/server/modules/audit/service');
  advances = await import('../src/server/modules/advances/service');
  transfers = await import('../src/server/modules/transfers/service');
  platform = await import('../src/server/modules/platform/service');
  settings = await import('../src/server/modules/settings/service');
  settingsReader = await import('../src/server/settings');

  const a = await bootstrap(A, 'A');
  const b = await bootstrap(B, 'B');
  Object.assign(ids, { entA: a.entityId, entB: b.entityId, accA: a.accountId, accB: b.accountId, cashA2: a.account2Id, catInA: a.categoryId, catInB: b.categoryId });
});

afterAll(async () => {
  await drop?.();
});

describe('l’application ne contourne pas la RLS', () => {
  it('le rôle de connexion n’est ni superutilisateur ni BYPASSRLS', async () => {
    const [r] = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean; user: string }[]>`SELECT rolsuper, rolbypassrls, current_user AS user FROM pg_roles WHERE rolname = current_user`;
    expect(r).toMatchObject({ user: 'sec_app', rolsuper: false, rolbypassrls: false });
  });

  it('TOUTE table portant organizationId a la RLS activée (garde-fou contre un oubli futur)', async () => {
    const { rows } = await admin.query<{ table_name: string; rls: boolean }>(
      `SELECT c.table_name, cl.relrowsecurity AS rls
       FROM information_schema.columns c
       JOIN pg_class cl ON cl.relname = c.table_name AND cl.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
       WHERE c.table_schema = current_schema() AND c.column_name = 'organizationId'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(28);
    expect(rows.filter((r) => !r.rls).map((r) => r.table_name)).toEqual([]);
  });
});

describe('isolation en lecture', () => {
  it('chaque organisation ne voit que ses lignes, même en SQL brut', async () => {
    const countA = await inOrg(A, async () => ({
      accounts: await prisma.account.count(),
      entities: await prisma.entity.count(),
      ledger: await prisma.ledgerEntry.count(),
      raw: Number((await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Account"`)[0]!.n),
    }));
    expect(countA).toEqual({ accounts: 2, entities: 1, ledger: 2, raw: 2 });
    const names = await inOrg(B, async () => (await prisma.account.findMany()).map((x) => x.name).sort());
    expect(names).toEqual(['Caisse B', 'Caisse bis B']);
  });

  it('sans organisation (connexion système), AUCUNE donnée métier n’est visible : échec fermé', async () => {
    const sys = db.systemDb();
    expect(await sys.account.count()).toBe(0);
    expect(await sys.entity.count()).toBe(0);
    expect(await sys.financialTransaction.count()).toBe(0);
    expect(await sys.auditLog.count()).toBe(0);
  });

  it('un compte d’une autre organisation est « introuvable », par id comme par liste', async () => {
    await inOrg(A, async () => {
      await expect(accounts.getAccount(actors.ctrlA!, ids.accB)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect((await accounts.listAccounts(actors.ctrlA!)).map((x) => x.id)).not.toContain(ids.accB);
    });
  });

  it('un acteur FORGÉ (rôle revendiqué dans l’entité de l’autre organisation) ne voit toujours rien', async () => {
    const forged = asOrg(A, 'forged', [{ entityId: ids.entB, role: 'CONTROLLER' }]);
    await inOrg(A, async () => {
      expect(await accounts.listAccounts(forged)).toEqual([]);
      await expect(accounts.getAccount(forged, ids.accB)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await prisma.entity.findMany({ where: { id: ids.entB } })).toEqual([]);
    });
  });

  it('les utilisateurs, le journal d’audit et les réglages sont propres à chaque organisation', async () => {
    const usersA = await inOrg(A, () => users.listUsers(actors.adminA!));
    expect(usersA.map((u) => u.email).sort()).toEqual(['admin.A@t.local', 'ctrl.A@t.local']);
    const logsA = await inOrg(A, () => audit.listAuditLogs(actors.ctrlA!));
    expect(logsA.length).toBeGreaterThan(0);
    const rawB = await inOrg(B, async () => (await prisma.auditLog.findMany()).map((l) => l.entityId));
    expect(rawB.some((id) => logsA.some((l) => l.entityId === id))).toBe(false);

    await inOrg(A, () => prisma.setting.create({ data: { key: 'allowSameApproverCashier', value: 'true' } }));
    expect(await inOrg(A, () => settingsReader.allowSameApproverCashier(prisma))).toBe(true);
    expect(await inOrg(B, () => settingsReader.allowSameApproverCashier(prisma))).toBe(false);
    await inOrg(B, () => settingsReader.getSetting(prisma, 'allowSameApproverCashier')).then((v) => expect(v).toBeNull());
    void settings;
  });
});

describe('isolation en écriture', () => {
  it('écrire une ligne au nom d’une autre organisation est refusé par la base (WITH CHECK)', async () => {
    await inOrg(A, async () => {
      await expect(
        prisma.$executeRaw`INSERT INTO "Category" ("id","organizationId","entityId","kind","name") VALUES ('intrus', ${B.id}, ${ids.entB}, 'INCOME'::"CategoryKind", 'Intrus')`,
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it('modifier ou supprimer en masse n’atteint jamais l’autre organisation', async () => {
    await inOrg(A, async () => {
      const touched = await prisma.$executeRaw`UPDATE "Account" SET "name" = 'PIRATÉ'`;
      expect(touched).toBe(2); // uniquement les 2 comptes de A
      await prisma.$executeRaw`UPDATE "Account" SET "name" = 'Caisse A' WHERE "id" = ${ids.accA}`;
    });
    const { rows } = await admin.query<{ name: string }>('SELECT name FROM "Account" WHERE "organizationId" = $1 ORDER BY name', [B.id]);
    expect(rows.map((r) => r.name)).toEqual(['Caisse B', 'Caisse bis B']);
  });

  it('une opération ne peut jamais lier des comptes de deux organisations (transfert, avance)', async () => {
    await inOrg(A, async () => {
      await expect(transfers.transferCashToCash(actors.ctrlA!, { fromAccountId: ids.accA, toAccountId: ids.accB, amount: '1.00' }, META))
        .rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(advances.createManualAdvance(actors.ctrlA!, { lenderAccountId: ids.accA, borrowerEntityId: ids.entB, amount: '5.00', beneficiary: 'X', purpose: 'test inter-organisation' }, META))
        .rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(incomes.createIncome(actors.ctrlA!, { entityId: ids.entA, source: 'x', categoryId: ids.catInB, amount: '1.00', currency: 'USD', paymentMethod: 'CASH', accountId: ids.accA }, META))
        .rejects.toMatchObject({ code: 'VALIDATION_ERROR' }); // catégorie de B : invisible
    });
  });

  it('les soldes de A et B sont totalement indépendants', async () => {
    await inOrg(A, () => incomes.createIncome(actors.ctrlA!, { entityId: ids.entA, source: 'Client A', categoryId: ids.catInA, amount: '25.00', currency: 'USD', paymentMethod: 'CASH', accountId: ids.accA }, META));
    const balA = await inOrg(A, async () => (await accounts.getAccount(actors.ctrlA!, ids.accA)).balance);
    const balB = await inOrg(B, async () => (await accounts.getAccount(actors.ctrlB!, ids.accB)).balance);
    expect(balA).toBe('125.00');
    expect(balB).toBe('100.00');
  });
});

describe('références et unicité par organisation', () => {
  it('deux organisations peuvent avoir la même entité (code, préfixe) et les MÊMES références', async () => {
    const mk = async (org: TestOrg, actor: ReturnType<typeof makeActor>, entityId: string, accountId: string, categoryId: string) =>
      inOrg(org, () => incomes.createIncome(actor, { entityId, source: 'Réf', categoryId, amount: '1.00', currency: 'USD', paymentMethod: 'CASH', accountId }, META));
    const a = await mk(A, actors.ctrlA!, ids.entA, ids.accA, ids.catInA);
    const b = await mk(B, actors.ctrlB!, ids.entB, ids.accB, ids.catInB);
    expect(a.reference).toMatch(/^SEC-REC-\d{4}-\d{5}$/);
    // compteurs indépendants : le numéro d'ordre de B ne dépend pas de l'activité de A
    const seq = (r: string) => Number(r.split('-')[3]);
    expect(seq(b.reference)).toBeLessThanOrEqual(seq(a.reference));
  });

  it('l’e-mail d’un utilisateur est unique sur toute la plateforme (connexion sans sélecteur d’organisation)', async () => {
    await expect(
      inOrg(B, () => users.createUser(actors.adminB!, { email: 'ctrl.A@t.local', fullName: 'Doublon', password: 'motdepasse-solide-9', roles: [] }, META)),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  });
});

describe('plateforme : création et suspension d’organisations', () => {
  const platformAdmin = { ...makeActor('platform', []), organizationId: null, isPlatformAdmin: true };
  const input = {
    name: 'Client C', slug: 'client-c', entityName: 'Client C SARL', entityCode: 'CCC', entityPrefix: 'CC',
    adminEmail: 'admin@client-c.local', adminName: 'Admin C', adminPassword: 'un-mot-de-passe-solide',
  };
  let orgCId = '';

  it('seul un administrateur de plateforme crée une organisation', async () => {
    await expect(platform.createOrganization(actors.adminA!, input, META)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(platform.listOrganizations(actors.ctrlA!)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('crée l’organisation avec son entité, ses catégories et son administrateur — immédiatement isolée', async () => {
    const res = await platform.createOrganization(platformAdmin, input, META);
    orgCId = res.id;
    const orgs = await platform.listOrganizations(platformAdmin);
    expect(orgs.find((o) => o.slug === 'client-c')).toMatchObject({ entities: 1, users: 1, isActive: true });

    const adminC = asOrg({ id: res.id, name: 'C' }, res.adminId, [{ entityId: res.entityId, role: 'ADMIN' }]);
    const seen = await runInOrg(res.id, async () => ({
      entities: (await prisma.entity.findMany()).map((e) => e.code),
      categories: await prisma.category.count(),
      accounts: await prisma.account.count(),
      users: (await users.listUsers(adminC)).map((u) => u.email),
    }));
    expect(seen).toEqual({ entities: ['CCC'], categories: 10, accounts: 0, users: ['admin@client-c.local'] });
    // …et A et B ne voient rien de C.
    expect(await inOrg(A, () => prisma.entity.count())).toBe(1);
    expect(await inOrg(B, () => prisma.user.count({ where: { email: 'admin@client-c.local' } }))).toBe(0);
  });

  it('refuse un identifiant ou un e-mail déjà pris ; l’événement de plateforme est invisible des organisations', async () => {
    await expect(platform.createOrganization(platformAdmin, { ...input, adminEmail: 'autre@client-c.local' }, META)).rejects.toMatchObject({ code: 'SLUG_TAKEN' });
    await expect(platform.createOrganization(platformAdmin, { ...input, slug: 'client-d' }, META)).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
    const visible = await inOrg(A, () => prisma.auditLog.findMany({ where: { action: 'platform.organization.create' } }));
    expect(visible).toEqual([]);
    const { rows } = await admin.query('SELECT count(*)::int AS n FROM "AuditLog" WHERE action = $1 AND "organizationId" IS NULL', ['platform.organization.create']);
    expect(rows[0].n).toBe(1);
  });

  it('suspendre une organisation invalide ses sessions', async () => {
    const adminRow = await admin.query<{ id: string }>('SELECT id FROM "User" WHERE email = $1', ['admin@client-c.local']);
    await admin.query('INSERT INTO "Session" ("id","userId","lastSeenAt","expiresAt") VALUES ($1,$2,now(),now() + interval \'1 hour\')', ['sess-c', adminRow.rows[0]!.id]);
    expect(await platform.setOrganizationActive(platformAdmin, orgCId, false, META)).toEqual({ id: orgCId, isActive: false });
    const sessions = await admin.query('SELECT count(*)::int AS n FROM "Session" WHERE id = $1', ['sess-c']);
    expect(sessions.rows[0].n).toBe(0);
    expect((await db.systemDb().organization.findUnique({ where: { id: orgCId } }))?.isActive).toBe(false);
  });
});
