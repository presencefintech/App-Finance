import { NextResponse } from 'next/server';
import { logout } from '@/server/auth';
import { handler } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(
  async ({ user, meta }) => {
    await logout(user!, meta);
    return NextResponse.json({ ok: true });
  },
  { allowPending2fa: true },
);
