import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import type { AccountType } from '@/generated/prisma/enums';
import type { CreateAccountInput, UpdateAccountInput } from '@/lib/schemas/accounts';
import type { Paginated } from '@/lib/schemas/common';
import { writeAudit } from '@/server/audit';
import type { CurrentUser, RequestMeta } from '@/server/auth';
import { encrypt } from '@/server/crypto';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { getAccountBalance, postTransaction } from '@/server/ledger';
import { D, ZERO, toMoneyString } from '@/server/money';
import { accessibleEntityIds, assertCan, assertEntityAccess } from '@/server/permissions';
import { requireStepUp } from '@/server/totp';

const accountSelect = {
  id: true, entityId: true, type: true, name: true, currency: true,
  bankName: true, holderName: true, accountNumberLast4: true,
  allowOverdraft: true, isActive: true, openedAt: true,
} satisfies Prisma.AccountSelect;

type AccountRow = Prisma.AccountGetPayload<{ select: typeof accountSelect }>;

export interface AccountView extends Omit<AccountRow, 'accountNumberLast4'> {
  /** Numéro masqué : ****1234 (le numéro complet n'est jamais renvoyé). */
  accountNumberMasked: string | null;
  balance: string;
}

const view = (a: AccountRow, balance: string): AccountView => {
  const { accountNumberLast4, ...rest } = a;
  return { ...rest, accountNumberMasked: accountNumberLast4 ? `****${accountNumberLast4}` : null, balance };
};

export async function listAccounts(
  user: CurrentUser,
  filter: { entityIds?: string[]; type?: AccountType } = {},
): Promise<AccountView[]> {
  // Règle 9 : toujours borné aux entités de l'utilisateur.
  const allowed = accessibleEntityIds(user);
  const entityIds = filter.entityIds ? filter.entityIds.filter((id) => allowed.includes(id)) : allowed;
  const readable = entityIds.filter((id) => user.roles.some((r) => r.entityId === id && hasRead(r.role)));
  const accounts = await prisma.account.findMany({
    where: { entityId: { in: readable }, ...(filter.type ? { type: filter.type } : {}) },
    select: accountSelect,
    orderBy: [{ entityId: 'asc' }, { type: 'asc' }, { name: 'asc' }],
  });
  const sums = await prisma.ledgerEntry.groupBy({
    by: ['accountId'],
    where: { accountId: { in: accounts.map((a) => a.id) } },
    _sum: { amount: true },
  });
  const balances = new Map(sums.map((s) => [s.accountId, s._sum.amount ? D(s._sum.amount) : ZERO]));
  return accounts.map((a) => view(a, toMoneyString(balances.get(a.id) ?? ZERO)));
}

function hasRead(role: CurrentUser['roles'][number]['role']): boolean {
  return ['ADMIN', 'CONTROLLER', 'DIRECTOR', 'CASHIER', 'VIEWER'].includes(role);
}

async function loadAccount(user: CurrentUser, id: string) {
  const account = await prisma.account.findUnique({ where: { id }, select: accountSelect });
  // Même réponse qu'un compte inexistant : pas de fuite d'existence entre entités.
  if (!account || !accessibleEntityIds(user).includes(account.entityId)) {
    throw new AppError('NOT_FOUND', 404, 'Compte introuvable');
  }
  assertCan(user, 'account.read', account.entityId);
  return account;
}

export async function getAccount(user: CurrentUser, id: string): Promise<AccountView> {
  const account = await loadAccount(user, id);
  return view(account, toMoneyString(await getAccountBalance(prisma, id)));
}

export async function getBalance(user: CurrentUser, id: string, at?: Date) {
  const account = await loadAccount(user, id);
  return { accountId: id, currency: account.currency, at: at ?? null, balance: toMoneyString(await getAccountBalance(prisma, id, at)) };
}

export async function getLedger(
  user: CurrentUser,
  id: string,
  q: { from?: Date; to?: Date; page: number; pageSize: number },
): Promise<Paginated<{ id: string; date: Date; reference: string; kind: string; status: string; description: string; amount: string; currency: string }>> {
  await loadAccount(user, id);
  const where: Prisma.LedgerEntryWhereInput = {
    accountId: id,
    ...(q.from || q.to ? { tx: { date: { gte: q.from, lte: q.to } } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.ledgerEntry.count({ where }),
    prisma.ledgerEntry.findMany({
      where,
      include: { tx: { select: { id: true, date: true, reference: true, kind: true, status: true, description: true } } },
      orderBy: [{ tx: { date: 'desc' } }, { createdAt: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return {
    data: rows.map((r) => ({
      id: r.id, date: r.tx.date, reference: r.tx.reference, kind: r.tx.kind, status: r.tx.status,
      description: r.tx.description, amount: toMoneyString(D(r.amount)), currency: r.currency,
    })),
    page: q.page, pageSize: q.pageSize, total,
  };
}

export async function createAccount(actor: CurrentUser, input: CreateAccountInput, meta: RequestMeta) {
  assertEntityAccess(actor, input.entityId);
  assertCan(actor, 'account.manage', input.entityId);
  if (input.type === 'BANK') requireStepUp(actor); // SPEC §9
  if (input.type === 'CASH' && (input.bankName || input.accountNumber)) {
    throw new AppError('VALIDATION_ERROR', 400, "Une caisse n'a ni banque ni numéro de compte");
  }
  if (input.openingBalance) assertCan(actor, 'transaction.record', input.entityId);

  const openedAt = input.openedAt ? new Date(input.openedAt) : new Date();
  return prisma.$transaction(async (tx) => {
    const account = await tx.account.create({
      data: {
        entityId: input.entityId, type: input.type, name: input.name, currency: input.currency,
        bankName: input.bankName, holderName: input.holderName,
        accountNumberEnc: input.accountNumber ? encrypt(input.accountNumber) : null,
        accountNumberLast4: input.accountNumber ? input.accountNumber.slice(-4) : null,
        allowOverdraft: input.type === 'BANK' ? (input.allowOverdraft ?? false) : false,
        openedAt,
      },
      select: accountSelect,
    });
    await writeAudit(tx, {
      actorId: actor.id, action: 'account.create', entityType: 'Account', entityId: account.id,
      after: { name: account.name, type: account.type, currency: account.currency, entityId: account.entityId }, ip: meta.ip,
    });
    if (input.openingBalance) {
      await postTransaction(tx, {
        entityId: input.entityId, kind: 'OPENING_BALANCE', date: openedAt,
        description: `Solde initial — ${account.name}`, createdById: actor.id,
        lines: [{ accountId: account.id, amount: D(input.openingBalance) }], ip: meta.ip,
      });
    }
    const balance = await getAccountBalance(tx, account.id);
    return view(account, toMoneyString(balance));
  });
}

export async function updateAccount(actor: CurrentUser, id: string, input: UpdateAccountInput, meta: RequestMeta) {
  const before = await prisma.account.findUnique({ where: { id }, select: accountSelect });
  if (!before || !accessibleEntityIds(actor).includes(before.entityId)) {
    throw new AppError('NOT_FOUND', 404, 'Compte introuvable');
  }
  assertCan(actor, 'account.manage', before.entityId);
  if (before.type === 'BANK') requireStepUp(actor);

  return prisma.$transaction(async (tx) => {
    if (input.isActive === false) {
      const balance = await getAccountBalance(tx, id);
      if (!balance.isZero()) {
        throw new AppError('ACCOUNT_NOT_EMPTY', 409, 'Impossible de désactiver un compte dont le solde est non nul');
      }
    }
    const after = await tx.account.update({ where: { id }, data: input, select: accountSelect });
    await writeAudit(tx, {
      actorId: actor.id, action: 'account.update', entityType: 'Account', entityId: id,
      before: { name: before.name, isActive: before.isActive, allowOverdraft: before.allowOverdraft },
      after: { name: after.name, isActive: after.isActive, allowOverdraft: after.allowOverdraft }, ip: meta.ip,
    });
    return view(after, toMoneyString(await getAccountBalance(tx, id)));
  });
}
