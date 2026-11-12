import { NextResponse } from 'next/server';
import { totpCodeSchema } from '@/lib/schemas/auth';
import { handler } from '@/server/http';
import { confirmTotpSetup } from '@/server/totp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(
  async ({ request, user, meta }) => {
    const { code } = totpCodeSchema.parse(await request.json());
    await confirmTotpSetup(user!, code, meta);
    return NextResponse.json({ ok: true });
  },
  { allowPending2fa: true },
);
