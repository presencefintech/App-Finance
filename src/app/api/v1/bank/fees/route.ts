import { NextResponse } from 'next/server';
import { bankFeeSchema } from '@/lib/schemas/operations';
import { handler } from '@/server/http';
import { recordBankFee } from '@/server/modules/transfers/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(
  async ({ request, user, meta }) =>
    NextResponse.json(await recordBankFee(user!, bankFeeSchema.parse(await request.json()), meta), { status: 201 }),
  { permission: 'transaction.record', idempotent: true },
);
