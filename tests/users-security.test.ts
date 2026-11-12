import { generateSync } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '../src/generated/prisma/enums';
import { createTestDb } from './helpers/db';
import { META, makeActor } from './helpers/fixtures';

type Db = typeof import('../src/server/db').prisma;
let prisma: Db;
let drop: () => Promise<void>;
let users: typeof import('../src/server/modules/users/service');
let settings: typeof import('../src/server/modules/settings/service');
let audit: typeof import('../src/server/modules/audit/service');
let accounts: typeof import('../src/server/modules/accounts/service');
let totp: typeof import('../src/server/totp');
let authMod: typeof import('../src/server/auth');
let crypto: typeof import('../src/server/crypto');

let SEC = '';
let ECOLE = '';
const A: Record<string, ReturnType<typeof makeActor>> = {};

async function person(name: string, roles: { entityId: string; role: Role }[]) {
  const u = await prisma.user.create({ data: { email: `${name}@t.local`, fullName: name, passwordHash: 'x', roles: { create: roles } } });
  A[name] = makeActor(u.id, roles);
  return u.id;
}

beforeAll(async () => {
  const db = await createTestDb();
  drop = db.drop;
  prisma = (await import('../src/server/db')).prisma;
  users = await import('../src/server/modules/users/service');
  settings = await import('../src/server/modules/settings/service');
  audit = await import('../src/server/modules/audit/service');
  accounts = await import('../src/server/modules/accounts/service');
  totp = await import('../src/server/totp');
  authMod = await import('../src/server/auth');
  crypto = await import('../src/server/crypto');

  SEC = (await prisma.entity.create({ data: { code: 'SEC', name: 'SEC SARL' } })).id;
  ECOLE = (await prisma.entity.create({ data: { code: 'ECOLE', name: 'École' } })).id;
  await person('admin', [{ entityId: SEC, role: 'ADMIN' }, { entityId: ECOLE, role: 'ADMIN' }]);
  await person('secController', [{ entityId: SEC, role: 'CONTROLLER' }]);
  await person('ecoleController', [{ entityId: ECOLE, role: 'CONTROLLER' }]);
  await person('cashier', [{ entityId: SEC, role: 'CASHIER' }]);
});

afterAll(async () => {
  await drop?.();
});

describe('gestion des utilisateurs (ADMIN) et audit', () => {
  it('toute action admin apparaît dans l’audit, avec avant/après', async () => {
    const created = await users.createUser(A.admin!, { email: 'new@t.local', fullName: 'Nouveau', password: 'motdepasse-solide-1', roles: [{ entityId: SEC, role: 'REQUESTER' }] }, META);
    await users.setUserRoles(A.admin!, created.id, [{ entityId: SEC, role: 'REQUESTER' }, { entityId: ECOLE, role: 'VIEWER' }], META);
    await users.updateUser(A.admin!, created.id, { isActive: false }, META);

    const logs = await prisma.auditLog.findMany({ where: { entityType: 'User', entityId: created.id }, orderBy: { at: 'asc' } });
    expect(logs.map((l) => l.action)).toEqual(['user.create', 'user.roles.set', 'user.update']);
    expect(logs[1]!.before).toMatchObject({ roles: [{ entityId: SEC, role: 'REQUESTER' }] });
    expect(logs[1]!.after).toMatchObject({ roles: expect.arrayContaining([{ entityId: ECOLE, role: 'VIEWER' }]) });
    expect(logs[2]!.before).toMatchObject({ isActive: true });
    expect(logs[2]!.after).toMatchObject({ isActive: false });
    expect(logs.every((l) => l.actorId === A.admin!.id && l.ip === META.ip)).toBe(true);
  });

  it('seul un ADMIN gère les utilisateurs ; e-mail unique ; mot de passe jamais stocké en clair', async () => {
    const input = { email: 'x@t.local', fullName: 'X Y', password: 'motdepasse-solide-2', roles: [] };
    await expect(users.createUser(A.secController!, input, META)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(users.listUsers(A.cashier!)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await users.createUser(A.admin!, input, META);
    await expect(users.createUser(A.admin!, input, META)).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
    const row = await prisma.user.findUniqueOrThrow({ where: { email: 'x@t.local' } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain('motdepasse');
    expect(await authMod.verifyPassword(row.passwordHash, 'motdepasse-solide-2')).toBe(true);
    expect(await authMod.verifyPassword(row.passwordHash, 'mauvais')).toBe(false);
  });

  it('garde-fous : pas d’auto-désactivation ni d’auto-rétrogradation ; désactiver coupe les sessions', async () => {
    await expect(users.updateUser(A.admin!, A.admin!.id, { isActive: false }, META)).rejects.toMatchObject({ code: 'SELF_DEACTIVATION' });
    await expect(users.setUserRoles(A.admin!, A.admin!.id, [{ entityId: SEC, role: 'VIEWER' }], META)).rejects.toMatchObject({ code: 'SELF_DEMOTION' });

    const uid = await person('victim', [{ entityId: SEC, role: 'VIEWER' }]);
    await prisma.session.create({ data: { id: 'sess-victim', userId: uid, lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) } });
    await users.updateUser(A.admin!, uid, { isActive: false }, META);
    expect(await prisma.session.count({ where: { userId: uid } })).toBe(0);
  });
});

describe('2FA TOTP et step-up (flux réels)', () => {
  it('secret chiffré en base, activation par code valide, step-up ouvre une fenêtre de 5 min', async () => {
    const actor = A.secController!;
    const setup = await totp.beginTotpSetup(actor);
    expect(setup.uri).toContain('otpauth://totp/');
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    expect(stored.totpSecretEnc).toBeTruthy();
    expect(stored.totpSecretEnc).not.toContain(setup.secret);
    expect(crypto.decrypt(stored.totpSecretEnc!)).toBe(setup.secret);
    expect(stored.totpEnabledAt).toBeNull();

    await expect(totp.confirmTotpSetup(actor, '000000', META)).rejects.toMatchObject({ code: 'INVALID_TOTP' });
    await totp.confirmTotpSetup(actor, generateSync({ secret: setup.secret }), META);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor.id } })).totpEnabledAt).not.toBeNull();
    await expect(totp.beginTotpSetup(actor)).rejects.toMatchObject({ code: 'TOTP_ALREADY_ENABLED' });

    // Step-up : sans session réelle, on en crée une pour l'acteur.
    await prisma.session.create({ data: { id: actor.sessionId, userId: actor.id, lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) } });
    await expect(totp.stepUp(actor, '123456', META)).rejects.toMatchObject({ code: 'INVALID_TOTP' });
    const until = await totp.stepUp(actor, generateSync({ secret: setup.secret }), META);
    expect(until.getTime() - Date.now()).toBeGreaterThan(4 * 60_000);
    expect(until.getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000 + 1000);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: actor.sessionId } })).stepUpUntil).not.toBeNull();
  });

  it('requireStepUp refuse sans fenêtre valide, accepte avec', () => {
    const none = makeActor('s1', [], { stepUp: false });
    expect(() => totp.requireStepUp(none)).toThrowError(/2FA/);
    expect(() => totp.requireStepUp(makeActor('s2', []))).not.toThrow();
    const expired = { ...makeActor('s3', []), stepUpUntil: new Date(Date.now() - 1000) };
    expect(() => totp.requireStepUp(expired)).toThrowError(/2FA/);
  });

  it('DISABLE_2FA=true : plus de step-up ni d’enrôlement obligatoire ; actif par défaut', async () => {
    const { twoFactorDisabled } = await import('../src/lib/totp-policy');
    expect(twoFactorDisabled()).toBe(false);
    process.env.DISABLE_2FA = 'true';
    try {
      expect(twoFactorDisabled()).toBe(true);
      expect(() => totp.requireStepUp(makeActor('s4', [], { stepUp: false }))).not.toThrow();
    } finally {
      process.env.DISABLE_2FA = 'false';
    }
    expect(() => totp.requireStepUp(makeActor('s5', [], { stepUp: false }))).toThrowError(/2FA/);
  });

  it('2FA obligatoire pour ADMIN/CONTROLLER/DIRECTOR/CASHIER, pas pour REQUESTER/VIEWER', async () => {
    const { isTotpRequired } = await import('../src/lib/totp-policy');
    for (const role of ['ADMIN', 'CONTROLLER', 'DIRECTOR', 'CASHIER'] as const) expect(isTotpRequired([{ role }])).toBe(true);
    for (const role of ['REQUESTER', 'VIEWER'] as const) expect(isTotpRequired([{ role }])).toBe(false);
  });
});

describe('plafonds et paramètres (ADMIN, step-up)', () => {
  it('modification d’un plafond : step-up requis, audit avant/après, valeur par défaut signalée', async () => {
    const before = await settings.listApprovalLimits(A.admin!, SEC);
    expect(before.find((l) => l.role === 'CONTROLLER' && l.currency === 'USD')).toMatchObject({ maxAmount: '500.00', isDefault: true });
    expect(before.find((l) => l.role === 'DIRECTOR' && l.currency === 'USD')).toMatchObject({ maxAmount: null });

    const noStepUp = makeActor(A.admin!.id, A.admin!.roles, { stepUp: false });
    const input = { entityId: SEC, role: 'CONTROLLER' as const, currency: 'USD' as const, maxAmount: '800.00' };
    await expect(settings.setApprovalLimit(noStepUp, input, META)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await expect(settings.setApprovalLimit(A.secController!, input, META)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await settings.setApprovalLimit(A.admin!, input, META);
    const after = await settings.listApprovalLimits(A.admin!, SEC);
    expect(after.find((l) => l.role === 'CONTROLLER' && l.currency === 'USD')).toMatchObject({ maxAmount: '800.00', isDefault: false });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'settings.approval-limit' } });
    expect(log.before).toMatchObject({ maxAmount: 'défaut' });
    expect(log.after).toMatchObject({ maxAmount: '800.00' });
  });

  it('paramètres : liste blanche et validation de valeur', async () => {
    await expect(settings.setAppSetting(A.admin!, 'inconnu', 'x', META)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(settings.setAppSetting(A.admin!, 'advanceAlertDays', '-3', META)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(settings.setAppSetting(A.secController!, 'advanceAlertDays', '45', META)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await settings.setAppSetting(A.admin!, 'advanceAlertDays', '45', META);
    expect((await settings.getAppSettings(A.admin!)).find((s) => s.key === 'advanceAlertDays')?.value).toBe('45');
  });
});

describe('journal d’audit : séparation des entités', () => {
  it('une contrôleuse ne voit que l’audit de SON entité ; les journaux globaux sont réservés à l’ADMIN', async () => {
    const secAcc = await accounts.createAccount(A.secController!, { entityId: SEC, type: 'CASH', name: 'Caisse SEC', currency: 'USD', openingBalance: '10.00' }, META);
    const ecoleAcc = await accounts.createAccount(A.ecoleController!, { entityId: ECOLE, type: 'CASH', name: 'Caisse École', currency: 'USD', openingBalance: '10.00' }, META);

    const secView = await audit.listAuditLogs(A.secController!);
    expect(secView.some((l) => l.entityType === 'Account' && l.entityId === secAcc.id)).toBe(true);
    expect(secView.some((l) => l.entityType === 'Account' && l.entityId === ecoleAcc.id)).toBe(false);
    expect(secView.some((l) => l.entityType === 'User')).toBe(false);

    const ecoleView = await audit.listAuditLogs(A.ecoleController!);
    expect(ecoleView.some((l) => l.entityId === secAcc.id)).toBe(false);

    const adminView = await audit.listAuditLogs(A.admin!);
    expect(adminView.some((l) => l.entityType === 'User')).toBe(true);
  });

  it('un caissier n’a pas accès au journal d’audit', async () => {
    await expect(audit.listAuditLogs(A.cashier!)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
