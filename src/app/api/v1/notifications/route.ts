import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { listNotifications, markAllRead } from '@/server/modules/notifications/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ user }) => NextResponse.json(await listNotifications(user!)));

export const POST = handler(async ({ user }) => {
  await markAllRead(user!);
  return NextResponse.json({ ok: true });
});
