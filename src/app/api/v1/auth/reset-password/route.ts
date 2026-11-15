import { NextResponse } from 'next/server';
import { resetPasswordSchema } from '@/lib/schemas/auth';
import { handler } from '@/server/http';
import { resetPassword } from '@/server/password-reset';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(
  async ({ request, meta }) => {
    const { token, newPassword } = resetPasswordSchema.parse(await request.json());
    await resetPassword(token, newPassword, meta);
    return NextResponse.json({ ok: true });
  },
  { auth: false },
);
