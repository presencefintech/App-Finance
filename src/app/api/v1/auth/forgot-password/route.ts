import { NextResponse } from 'next/server';
import { forgotPasswordSchema } from '@/lib/schemas/auth';
import { handler } from '@/server/http';
import { requestPasswordReset } from '@/server/password-reset';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Réponse toujours identique : on ne révèle pas si l'adresse existe. */
export const POST = handler(
  async ({ request }) => {
    const { email } = forgotPasswordSchema.parse(await request.json());
    await requestPasswordReset(email);
    return NextResponse.json({ ok: true });
  },
  { auth: false },
);
