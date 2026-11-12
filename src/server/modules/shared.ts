import 'server-only';
import type { Account, Prisma } from '@/generated/prisma/client';
import type { Permission } from '@/lib/permissions';
import type { FxFormInput } from '@/lib/schemas/operations';
import type { CurrentUser } from '@/server/auth';
import { AppError } from '@/server/errors';
import type { FxInput } from '@/server/ledger';
import { D, round2, type Money } from '@/server/money';
import { accessibleEntityIds, assertCan } from '@/server/permissions';

type Tx = Prisma.TransactionClient;

/** Charge un compte accessible à l'utilisateur (404 sinon) et vérifie la permission dans son entité. */
export async function loadAccountFor(tx: Tx, actor: CurrentUser, id: string, permission: Permission): Promise<Account> {
  const account = await tx.account.findUnique({ where: { id } });
  if (!account || !accessibleEntityIds(actor).includes(account.entityId)) {
    throw new AppError('NOT_FOUND', 404, 'Compte introuvable');
  }
  assertCan(actor, permission, account.entityId);
  return account;
}

export function parseInputDate(value?: string): Date {
  if (!value) return new Date();
  const d = new Date(value.length === 10 ? `${value}T12:00:00+02:00` : value);
  if (Number.isNaN(d.getTime())) throw new AppError('VALIDATION_ERROR', 400, 'Date invalide');
  if (d.getTime() > Date.now() + 24 * 3600 * 1000) throw new AppError('VALIDATION_ERROR', 400, 'Date dans le futur');
  return d;
}

/** Une caisse reçoit/paie en espèces ; un compte bancaire jamais en espèces. */
export function assertPaymentMethodMatches(account: Account, method: string) {
  const isCashMethod = method === 'CASH';
  if (account.type === 'CASH' && !isCashMethod) {
    throw new AppError('VALIDATION_ERROR', 400, 'Une caisse ne peut recevoir ou payer qu’en espèces');
  }
  if (account.type === 'BANK' && isCashMethod) {
    throw new AppError('VALIDATION_ERROR', 400, 'Un compte bancaire ne peut pas être utilisé pour un paiement en espèces');
  }
}

/**
 * Construit la conversion (règle 2) : montant d'origine, devise, taux, date du taux, source, contre-valeur.
 * Contre-valeur calculée (arrondie à 2 décimales) si non fournie.
 */
export function buildFx(input: FxFormInput, from: Account, to: Account, fromAmount: Money): { fx: FxInput; toAmount: Money } {
  const rate = D(input.rate);
  const toAmount = input.toAmount ? D(input.toAmount) : round2(fromAmount.times(rate));
  return {
    toAmount,
    fx: {
      fromAmount, fromCurrency: from.currency, toAmount, toCurrency: to.currency,
      rate, rateDate: new Date(input.rateDate), rateSource: input.rateSource,
    },
  };
}
