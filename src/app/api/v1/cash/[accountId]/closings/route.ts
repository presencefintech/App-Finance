import { NextResponse } from 'next/server';
import { cashClosingSchema } from '@/lib/schemas/operations';
import { handler } from '@/server/http';
import { closeCashDay, listCashSessions } from '@/server/modules/cash/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ user, params }) =>
  NextResponse.json({ data: await listCashSessions(user!, params.accountId!) }),
);

export const POST = handler(
  async ({ request, user, params, meta }) =>
    NextResponse.json(
      await closeCashDay(user!, params.accountId!, cashClosingSchema.parse(await request.json()), meta),
      { status: 201 },
    ),
  { permission: 'cash.close', idempotent: true },
);
