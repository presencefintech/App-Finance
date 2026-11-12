import { NextResponse } from 'next/server';
import { totpCodeSchema } from '@/lib/schemas/auth';
import { handler } from '@/server/http';
import { stepUp } from '@/server/totp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(async ({ request, user, meta }) => {
  const { code } = totpCodeSchema.parse(await request.json());
  const until = await stepUp(user!, code, meta);
  return NextResponse.json({ stepUpUntil: until.toISOString() });
});
