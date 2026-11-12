import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '../src/generated/prisma/enums';
import { canAccessPath, landingPath, visibleNav } from '../src/lib/navigation';
import { createTestDb } from './helpers/db';
import { META, makeActor } from './helpers/fixtures';

const menu = (role: Role) => visibleNav([{ role }]).map((i) => i.href);

describe('menu par rôle (matrice de visibilité)', () => {
  it('REQUESTER : uniquement ses demandes et son profil', () => {
    expect(menu('REQUESTER')).toEqual(['/demandes', '/profil']);
  });

  it('VIEWER : consultation seule — pas de rapprochement, d’audit ni de paramètres', () => {
    expect(menu('VIEWER')).toEqual([
      '/', '/demandes', '/recettes', '/depenses', '/caisses', '/banques', '/avances', '/taux-de-change', '/budgets', '/rapports', '/registres', '/profil',
    ]);
  });

  it('CASHIER : opérations de caisse, mais ni rapports, ni audit, ni rapprochement, ni paramètres', () => {
    const m = menu('CASHIER');
    expect(m).toEqual(expect.arrayContaining(['/', '/demandes', '/caisses', '/banques', '/registres']));
    for (const forbidden of ['/rapports', '/audit', '/rapprochements', '/parametres']) expect(m).not.toContain(forbidden);
  });

  it('CONTROLLER : tout sauf les paramètres d’administration', () => {
    const m = menu('CONTROLLER');
    expect(m).toEqual(expect.arrayContaining(['/', '/demandes', '/rapprochements', '/rapports', '/audit', '/registres']));
    expect(m).not.toContain('/parametres');
  });

  it('DIRECTOR : décision et supervision, sans rapprochement ni paramètres', () => {
    const m = menu('DIRECTOR');
    expect(m).toEqual(expect.arrayContaining(['/', '/demandes', '/rapports', '/audit']));
    for (const forbidden of ['/rapprochements', '/parametres']) expect(m).not.toContain(forbidden);
  });

  it('ADMIN : accès, paramètres et audit, mais pas les demandes de fonds ni le rapprochement', () => {
    const m = menu('ADMIN');
    expect(m).toEqual(expect.arrayContaining(['/parametres', '/audit', '/caisses', '/banques']));
    for (const forbidden of ['/demandes', '/rapprochements']) expect(m).not.toContain(forbidden);
  });

  it('un utilisateur cumulant des rôles voit l’union de leurs menus', () => {
    const m = visibleNav([{ role: 'REQUESTER' }, { role: 'CONTROLLER' }]).map((i) => i.href);
    expect(m).toEqual(expect.arrayContaining(['/demandes', '/rapprochements', '/']));
  });

  it('accès direct par URL : mêmes règles que le menu (sous-pages comprises)', () => {
    const req = [{ role: 'REQUESTER' as const }];
    expect(canAccessPath('/demandes/abc', req)).toBe(true);
    for (const p of ['/', '/caisses', '/caisses/123', '/rapports', '/registres', '/parametres/utilisateurs', '/audit', '/rapprochements/9']) {
      expect(canAccessPath(p, req)).toBe(false);
    }
    expect(canAccessPath('/parametres/plafonds', [{ role: 'CONTROLLER' }])).toBe(false);
    expect(canAccessPath('/parametres/plafonds', [{ role: 'ADMIN' }])).toBe(true);
    expect(canAccessPath('/caisses/123', [{ role: 'VIEWER' }])).toBe(true);
    expect(canAccessPath('/profil', [])).toBe(true);
  });

  it('page d’atterrissage : le tableau de bord si autorisé, sinon la première page accessible', () => {
    expect(landingPath([{ role: 'CONTROLLER' }])).toBe('/');
    expect(landingPath([{ role: 'REQUESTER' }])).toBe('/demandes');
    expect(landingPath([])).toBe('/profil');
  });
});

describe('API : les lectures exigent la permission dans l’entité, pas seulement l’accès', () => {
  type Db = typeof import('../src/server/db').prisma;
  let prisma: Db;
  let drop: () => Promise<void>;
  let SEC = '';
  const A: Record<string, ReturnType<typeof makeActor>> = {};
  let svc: {
    accounts: typeof import('../src/server/modules/accounts/service');
    incomes: typeof import('../src/server/modules/incomes/service');
    expenses: typeof import('../src/server/modules/expenses/service');
    transfers: typeof import('../src/server/modules/transfers/service');
    advances: typeof import('../src/server/modules/advances/service');
    budgets: typeof import('../src/server/modules/budgets/service');
    stats: typeof import('../src/server/modules/stats/service');
  };
  let incomeId = '';
  let expenseId = '';

  beforeAll(async () => {
    const db = await createTestDb();
    drop = db.drop;
    prisma = (await import('../src/server/db')).prisma;
    svc = {
      accounts: await import('../src/server/modules/accounts/service'),
      incomes: await import('../src/server/modules/incomes/service'),
      expenses: await import('../src/server/modules/expenses/service'),
      transfers: await import('../src/server/modules/transfers/service'),
      advances: await import('../src/server/modules/advances/service'),
      budgets: await import('../src/server/modules/budgets/service'),
      stats: await import('../src/server/modules/stats/service'),
    };
    SEC = (await prisma.entity.create({ data: { code: 'SEC', prefix: 'SEC', name: 'SEC SARL' } })).id;
    const person = async (name: string, role: Role) => {
      const u = await prisma.user.create({ data: { email: `${name}@t.local`, fullName: name, passwordHash: 'x', roles: { create: [{ entityId: SEC, role }] } } });
      A[name] = makeActor(u.id, [{ entityId: SEC, role }]);
    };
    await person('ctrl', 'CONTROLLER');
    await person('requester', 'REQUESTER');
    await person('viewer', 'VIEWER');
    await person('cashier', 'CASHIER');

    const cash = await svc.accounts.createAccount(A.ctrl!, { entityId: SEC, type: 'CASH', name: 'Caisse', currency: 'USD', openingBalance: '500.00' }, META);
    const bank = await svc.accounts.createAccount(A.ctrl!, { entityId: SEC, type: 'BANK', name: 'Banque', currency: 'USD', bankName: 'Rawbank', openingBalance: '900.00' }, META);
    const inc = await prisma.category.create({ data: { entityId: SEC, kind: 'INCOME', name: 'Partenaires' } });
    const out = await prisma.category.create({ data: { entityId: SEC, kind: 'EXPENSE', name: 'Fournitures' } });
    incomeId = (await svc.incomes.createIncome(A.ctrl!, { entityId: SEC, source: 'Client', categoryId: inc.id, amount: '10.00', currency: 'USD', paymentMethod: 'CASH', accountId: cash.id }, META)).id;
    expenseId = (await svc.expenses.createExpense(A.ctrl!, { entityId: SEC, categoryId: out.id, beneficiary: 'Papeterie', purpose: 'achat', amount: '5.00', currency: 'USD', paymentMethod: 'CASH', accountId: cash.id }, META)).id;
    await svc.transfers.initiateWithdrawal(A.ctrl!, { bankAccountId: bank.id, cashAccountId: cash.id, amount: '50.00' }, META);
    await svc.budgets.createBudget(A.ctrl!, {
      entityId: SEC, name: 'B', periodStart: new Date(Date.now() - 86_400_000).toISOString(), periodEnd: new Date(Date.now() + 86_400_000).toISOString(), currency: 'USD',
      lines: [{ categoryId: out.id, amount: '100.00' }],
    }, META);
  });

  afterAll(async () => {
    await drop?.();
  });

  it('un demandeur ne lit ni recettes, ni dépenses, ni retraits, ni budgets, ni avances, ni comptes', async () => {
    const r = A.requester!;
    expect((await svc.incomes.listIncomes(r, { page: 1, pageSize: 50 })).total).toBe(0);
    expect((await svc.expenses.listExpenses(r, { page: 1, pageSize: 50 })).total).toBe(0);
    await expect(svc.incomes.getIncome(r, incomeId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.expenses.getExpense(r, expenseId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await svc.transfers.listWithdrawals(r)).toEqual([]);
    expect(await svc.budgets.listBudgets(r)).toEqual([]);
    expect(await svc.advances.listAdvances(r)).toEqual([]);
    expect(await svc.accounts.listAccounts(r)).toEqual([]);
    await expect(svc.stats.monthlySeries(r, SEC, 3)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('le lecteur consulte tout mais ne peut rien enregistrer', async () => {
    const v = A.viewer!;
    expect((await svc.incomes.listIncomes(v, { page: 1, pageSize: 50 })).total).toBe(1);
    expect((await svc.expenses.listExpenses(v, { page: 1, pageSize: 50 })).total).toBe(1);
    expect(await svc.transfers.listWithdrawals(v)).toHaveLength(1);
    expect(await svc.budgets.listBudgets(v)).toHaveLength(1);
    const acc = (await svc.accounts.listAccounts(v))[0]!;
    await expect(svc.incomes.createIncome(v, { entityId: SEC, source: 'X', categoryId: 'x', amount: '1.00', currency: 'USD', paymentMethod: 'CASH', accountId: acc.id }, META))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(svc.budgets.createBudget(v, {
      entityId: SEC, name: 'x', periodStart: new Date().toISOString(), periodEnd: new Date(Date.now() + 86_400_000).toISOString(), currency: 'USD', lines: [{ categoryId: 'x', amount: '1.00' }],
    }, META)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('le caissier lit les opérations de son entité', async () => {
    expect((await svc.incomes.listIncomes(A.cashier!, { page: 1, pageSize: 50 })).total).toBe(1);
  });
});
