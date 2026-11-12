import { NextResponse } from 'next/server';
import { loginSchema } from '@/lib/schemas/auth';
import { login, setSessionCookie } from '@/server/auth';
import { handler } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(
  async ({ request, meta }) => {
    const { email, password, totp } = loginSchema.parse(await request.json());
    const token = await login(email, password, totp, meta);
    await setSessionCookie(token);
    return NextResponse.json({ ok: true });
  },
  { auth: false },
);
