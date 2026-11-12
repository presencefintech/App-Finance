import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { beginTotpSetup } from '@/server/totp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(async ({ user }) => NextResponse.json(await beginTotpSetup(user!)), {
  allowPending2fa: true,
});
