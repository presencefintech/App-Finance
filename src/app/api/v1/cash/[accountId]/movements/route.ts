import { NextResponse } from 'next/server';
import { cashMovementSchema } from '@/lib/schemas/operations';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { handler } from '@/server/http';
import { recordExpense } from '@/server/modules/expenses/service';
import { recordIncome } from '@/server/modules/incomes/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Entrée de caisse = recette en espèces ; sortie de caisse = dépense en espèces. */
export const POST = handler(
  async ({ request, user, params, meta }) => {
    const i = cashMovementSchema.parse(await request.json());
    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.account.findUnique({ where: { id: params.accountId! } });
      if (!account || account.type !== 'CASH') throw new AppError('NOT_FOUND', 404, 'Caisse introuvable');
      const base = {
        entityId: account.entityId, accountId: account.id, categoryId: i.categoryId, amount: i.amount,
        currency: account.currency, paymentMethod: 'CASH' as const, date: i.date, attachmentIds: i.attachmentIds,
      };
      return i.direction === 'IN'
        ? recordIncome(tx, user!, { ...base, source: i.counterparty, note: i.description }, meta)
        : recordExpense(tx, user!, { ...base, beneficiary: i.counterparty, purpose: i.description }, meta);
    });
    return NextResponse.json(result, { status: 201 });
  },
  { permission: 'transaction.record', idempotent: true },
);
