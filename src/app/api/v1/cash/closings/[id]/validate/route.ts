import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { validateCashSession } from '@/server/modules/cash/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(
  async ({ user, params, meta }) => NextResponse.json(await validateCashSession(user!, params.id!, meta)),
  { permission: 'cash.validate', idempotent: true },
);
