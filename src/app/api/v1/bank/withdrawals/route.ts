import { NextResponse } from 'next/server';
import { withdrawalSchema } from '@/lib/schemas/operations';
import { handler } from '@/server/http';
import { initiateWithdrawal, listWithdrawals } from '@/server/modules/transfers/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ request, user }) => {
  const s = new URL(request.url).searchParams.get('status');
  const status = s === 'IN_TRANSIT' || s === 'CONFIRMED' || s === 'CANCELLED' ? s : undefined;
  return NextResponse.json({ data: await listWithdrawals(user!, status) });
});

export const POST = handler(
  async ({ request, user, meta }) =>
    NextResponse.json(await initiateWithdrawal(user!, withdrawalSchema.parse(await request.json()), meta), { status: 201 }),
  { permission: 'transaction.record', idempotent: true },
);
