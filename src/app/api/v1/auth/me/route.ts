import { NextResponse } from 'next/server';
import { handler } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(
  async ({ user }) => {
    const { id, email, fullName, roles, totpEnabled, needsTotpSetup, organizationId, isPlatformAdmin } = user!;
    return NextResponse.json({ id, email, fullName, roles, totpEnabled, needsTotpSetup, organizationId, isPlatformAdmin });
  },
  { allowPending2fa: true },
);
