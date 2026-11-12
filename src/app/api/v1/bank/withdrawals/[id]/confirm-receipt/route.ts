import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { confirmWithdrawal } from '@/server/modules/transfers/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(
  async ({ user, params, meta }) => NextResponse.json(await confirmWithdrawal(user!, params.id!, meta)),
  { permission: 'transaction.record', idempotent: true },
);
