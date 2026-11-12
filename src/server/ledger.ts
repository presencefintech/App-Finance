import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import type { Currency, TxKind } from '@/generated/prisma/enums';
import { writeAudit } from './audit';
import { AppError } from './errors';
import { D, ZERO, round2, sum, type Money } from './money';
import { nextReference } from './references';
import { localDay } from '@/lib/dates';

export interface LedgerLine {
  accountId: string;
  /** Signé : + entrée, − sortie, dans la devise du compte. */
  amount: Money;
}

export interface FxInput {
  fromAmount: Money;
  fromCurrency: Currency;
  toAmount: Money;
  toCurrency: Currency;
  /** 1 fromCurrency = rate toCurrency */
  rate: Money;
  rateDate: Date;
  rateSource: string;
}

export interface PostTransactionInput {
  /** Entité qui porte l'opération (pour une avance : celle qui décaisse). */
  entityId: string;
  kind: TxKind;
  date: Date;
  description: string;
  createdById: string;
  lines: LedgerLine[];
  fx?: FxInput;
  reversalOfId?: string;
  reversalReason?: string;
  links?: { fundRequestId?: string; incomeId?: string; expenseId?: string; advanceId?: string };
  ip?: string | null;
}

/** Transferts : deux lignes, une sortie et une entrée. */
const TRANSFER_KINDS: readonly TxKind[] = [
  'CASH_TO_BANK', 'BANK_TO_CASH', 'BANK_TO_BANK', 'CASH_TO_CASH', 'ADVANCE_REPAYMENT',
];
const CREDIT_ONLY: readonly TxKind[] = ['OPENING_BALANCE', 'INCOME'];
const DEBIT_ONLY: readonly TxKind[] = ['EXPENSE', 'BANK_FEE', 'ADVANCE_DISBURSEMENT'];
/** Seul un remboursement d'avance peut impliquer des comptes de l'autre entité. */
const CROSS_ENTITY_KINDS: readonly TxKind[] = ['ADVANCE_REPAYMENT'];

const DOC_TYPE: Record<TxKind, string> = {
  OPENING_BALANCE: 'OUV', INCOME: 'REC', EXPENSE: 'DEP',
  CASH_TO_BANK: 'VER', BANK_TO_CASH: 'RET', BANK_TO_BANK: 'VIR', CASH_TO_CASH: 'TRC',
  BANK_FEE: 'FRB', ADVANCE_DISBURSEMENT: 'AVA', ADVANCE_REPAYMENT: 'REM',
  CASH_ADJUSTMENT: 'ECA', REVERSAL: 'CTP',
};

const invalid = (message: string, details?: unknown) =>
  new AppError('INVALID_TRANSACTION', 400, message, details);

interface LockedAccount {
  id: string;
  entityId: string;
  type: 'CASH' | 'BANK';
  currency: Currency;
  isActive: boolean;
  allowOverdraft: boolean;
}

/** Solde d'un compte = Σ des écritures (règle 3). */
export async function getAccountBalance(
  db: Prisma.TransactionClient | Prisma.DefaultPrismaClient,
  accountId: string,
  at?: Date,
): Promise<Money> {
  const agg = await db.ledgerEntry.aggregate({
    where: { accountId, ...(at ? { tx: { date: { lte: at } } } : {}) },
    _sum: { amount: true },
  });
  return agg._sum.amount ? D(agg._sum.amount) : ZERO;
}

/**
 * Point d'entrée UNIQUE de toute écriture financière.
 * Doit être appelé dans `prisma.$transaction` (règle 4) ; verrouille les comptes avant le contrôle de solde.
 */
export async function postTransaction(tx: Prisma.TransactionClient, input: PostTransactionInput) {
  const { lines, kind } = input;
  if (lines.length === 0) throw invalid('Aucune ligne');
  if (!input.description.trim()) throw invalid('Description requise');
  if (lines.some((l) => l.amount.isZero())) throw invalid('Montant nul interdit');
  if (lines.some((l) => l.amount.decimalPlaces() > 2)) throw invalid('Maximum 2 décimales');

  // 1. Verrou des comptes, ordre trié (pas de deadlock).
  const ids = [...new Set(lines.map((l) => l.accountId))].sort();
  const accounts = await tx.$queryRaw<LockedAccount[]>`
    SELECT "id", "entityId", "type", "currency", "isActive", "allowOverdraft"
    FROM "Account" WHERE "id" = ANY(${ids}) ORDER BY "id" FOR UPDATE`;
  if (accounts.length !== ids.length) throw new AppError('ACCOUNT_NOT_FOUND', 404, 'Compte introuvable');
  const byId = new Map(accounts.map((a) => [a.id, a]));

  // 2. Comptes actifs, entité cohérente.
  for (const a of accounts) {
    if (!a.isActive) throw new AppError('ACCOUNT_INACTIVE', 409, 'Compte désactivé');
    if (a.entityId !== input.entityId && !CROSS_ENTITY_KINDS.includes(kind) && kind !== 'REVERSAL') {
      throw new AppError('ENTITY_MISMATCH', 400, "Le compte n'appartient pas à l'entité de l'opération");
    }
  }

  // 2b. Jour de caisse clôturé : plus aucune écriture ce jour-là (ni avant) ; seule une contre-passation
  //     (datée du jour) ou l'ajustement d'écart validé peut passer.
  if (kind !== 'REVERSAL' && kind !== 'CASH_ADJUSTMENT') {
    const closed = await tx.cashSession.findFirst({
      where: { accountId: { in: ids }, date: { gte: localDay(input.date) } },
      select: { date: true },
    });
    if (closed) {
      throw new AppError('DAY_CLOSED', 409, 'La journée de caisse est clôturée : passez par une contre-passation datée du jour');
    }
  }

  // 3. Règles de forme par type d'opération.
  if (CREDIT_ONLY.includes(kind) && lines.some((l) => l.amount.isNegative())) {
    throw invalid('Cette opération ne peut créer que des entrées');
  }
  if (DEBIT_ONLY.includes(kind) && lines.some((l) => l.amount.isPositive())) {
    throw invalid('Cette opération ne peut créer que des sorties');
  }

  // 4. Équilibre et devises (règle 2) — sauf contre-passation, inverse exact de l'originale.
  if (kind !== 'REVERSAL') {
    const currencies = new Set(lines.map((l) => byId.get(l.accountId)!.currency));
    if (TRANSFER_KINDS.includes(kind)) {
      if (lines.length !== 2) throw invalid('Un transfert comporte exactement deux lignes');
      const out = lines.find((l) => l.amount.isNegative());
      const inn = lines.find((l) => l.amount.isPositive());
      if (!out || !inn) throw invalid('Un transfert comporte une sortie et une entrée');
      if (out.accountId === inn.accountId) throw invalid('Comptes source et destination identiques');
      if (currencies.size === 1) {
        if (!sum(lines.map((l) => l.amount)).isZero()) throw invalid('Transfert déséquilibré');
        if (input.fx) throw invalid('Conversion fournie pour un transfert dans une seule devise');
      } else {
        assertFxConsistent(input.fx, out, inn, byId);
      }
    } else if (currencies.size > 1) {
      throw new AppError('CURRENCY_MISMATCH', 400, 'Plusieurs devises sans conversion enregistrée');
    }
  }

  // 5. Soldes suffisants (après verrou) : jamais de caisse négative, banque selon découvert.
  const deltas = new Map<string, Money>();
  for (const l of lines) deltas.set(l.accountId, (deltas.get(l.accountId) ?? ZERO).plus(l.amount));
  for (const [accountId, delta] of deltas) {
    if (!delta.isNegative()) continue;
    const acc = byId.get(accountId)!;
    if (acc.type === 'BANK' && acc.allowOverdraft) continue;
    const balance = await getAccountBalance(tx, accountId);
    if (balance.plus(delta).isNegative()) {
      throw new AppError('INSUFFICIENT_FUNDS', 409, 'Solde insuffisant', {
        accountId, balance: balance.toFixed(2), required: delta.abs().toFixed(2), currency: acc.currency,
      });
    }
  }

  // 6. Écriture.
  const entity = await tx.entity.findUnique({ where: { id: input.entityId }, select: { code: true } });
  if (!entity) throw new AppError('ENTITY_NOT_FOUND', 404, 'Entité introuvable');
  const reference = await nextReference(tx, input.entityId, DOC_TYPE[kind], input.date);

  const created = await tx.financialTransaction.create({
    data: {
      reference,
      entityId: input.entityId,
      kind,
      date: input.date,
      description: input.description.trim(),
      createdById: input.createdById,
      reversalOfId: input.reversalOfId,
      reversalReason: input.reversalReason,
      ...input.links,
      entries: {
        create: lines.map((l) => ({
          accountId: l.accountId,
          amount: l.amount,
          currency: byId.get(l.accountId)!.currency,
        })),
      },
      fx: input.fx
        ? {
            create: {
              fromAmount: input.fx.fromAmount, fromCurrency: input.fx.fromCurrency,
              toAmount: input.fx.toAmount, toCurrency: input.fx.toCurrency,
              rate: input.fx.rate, rateDate: input.fx.rateDate, rateSource: input.fx.rateSource,
            },
          }
        : undefined,
    },
    include: { entries: true, fx: true },
  });

  await writeAudit(tx, {
    actorId: input.createdById,
    action: `transaction.${kind.toLowerCase()}`,
    entityType: 'FinancialTransaction',
    entityId: created.id,
    after: {
      reference, kind, entityId: input.entityId,
      lines: lines.map((l) => ({ accountId: l.accountId, amount: l.amount.toFixed(2) })),
    },
    ip: input.ip,
  });
  return created;
}

function assertFxConsistent(
  fx: FxInput | undefined,
  out: LedgerLine,
  inn: LedgerLine,
  byId: Map<string, LockedAccount>,
) {
  if (!fx) throw new AppError('FX_REQUIRED', 400, 'Conversion (taux, date, source) obligatoire entre deux devises');
  const outCur = byId.get(out.accountId)!.currency;
  const inCur = byId.get(inn.accountId)!.currency;
  if (fx.fromCurrency !== outCur || fx.toCurrency !== inCur || fx.fromCurrency === fx.toCurrency) {
    throw new AppError('FX_MISMATCH', 400, 'Devises de la conversion incohérentes avec les comptes');
  }
  if (!fx.fromAmount.equals(out.amount.abs()) || !fx.toAmount.equals(inn.amount)) {
    throw new AppError('FX_MISMATCH', 400, 'Montants de la conversion incohérents avec les écritures');
  }
  if (!fx.rate.isPositive() || !fx.rateSource.trim()) {
    throw new AppError('FX_MISMATCH', 400, 'Taux et source obligatoires');
  }
  const expected = round2(fx.fromAmount.times(fx.rate));
  if (expected.minus(fx.toAmount).abs().greaterThan('0.01')) {
    throw new AppError('FX_MISMATCH', 400, 'Contre-valeur incohérente avec le taux', {
      expected: expected.toFixed(2), received: fx.toAmount.toFixed(2),
    });
  }
}
