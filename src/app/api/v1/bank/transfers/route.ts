import { NextResponse } from 'next/server';
import { transferSchema } from '@/lib/schemas/operations';
import { handler } from '@/server/http';
import { transferBankToBank } from '@/server/modules/transfers/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(
  async ({ request, user, meta }) =>
    NextResponse.json(await transferBankToBank(user!, transferSchema.parse(await request.json()), meta), { status: 201 }),
  { permission: 'transaction.record', idempotent: true },
);
