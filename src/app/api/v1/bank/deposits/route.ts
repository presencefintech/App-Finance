import { NextResponse } from 'next/server';
import { depositSchema } from '@/lib/schemas/operations';
import { handler } from '@/server/http';
import { depositToBank } from '@/server/modules/transfers/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(
  async ({ request, user, meta }) =>
    NextResponse.json(await depositToBank(user!, depositSchema.parse(await request.json()), meta), { status: 201 }),
  { permission: 'transaction.record', idempotent: true },
);
