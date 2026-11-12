import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handler } from '@/server/http';
import { cancelWithdrawal } from '@/server/modules/transfers/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(
  async ({ request, user, params, meta }) => {
    const { reason } = z.object({ reason: z.string().trim().min(3) }).parse(await request.json());
    return NextResponse.json(await cancelWithdrawal(user!, params.id!, reason, meta));
  },
  { permission: 'transaction.record', idempotent: true },
);
