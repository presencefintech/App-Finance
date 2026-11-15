import { NextResponse } from 'next/server';
import { changePasswordSchema } from '@/lib/schemas/auth';
import { changePassword } from '@/server/auth';
import { handler } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(
  async ({ request, user, meta }) => {
    const input = changePasswordSchema.parse(await request.json());
    await changePassword(user!, input.currentPassword, input.newPassword, meta);
    return NextResponse.json({ ok: true });
  },
  { allowPending2fa: true },
);
