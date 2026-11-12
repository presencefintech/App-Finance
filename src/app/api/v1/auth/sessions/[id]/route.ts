import { NextResponse } from 'next/server';
import { revokeSession } from '@/server/auth';
import { handler } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DELETE = handler(async ({ user, params, meta }) => {
  await revokeSession(user!, params.id!, meta);
  return NextResponse.json({ ok: true });
});
