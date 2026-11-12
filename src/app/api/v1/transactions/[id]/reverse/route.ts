import { NextResponse } from 'next/server';
import { reverseSchema } from '@/lib/schemas/accounts';
import { handler } from '@/server/http';
import { reverseTransaction } from '@/server/modules/transactions/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(
  async ({ request, user, params, meta }) => {
    const { reason } = reverseSchema.parse(await request.json());
    const reversal = await reverseTransaction(user!, params.id!, reason, meta);
    return NextResponse.json({ id: reversal.id, reference: reversal.reference }, { status: 201 });
  },
  { permission: 'transaction.reverse', idempotent: true },
);
