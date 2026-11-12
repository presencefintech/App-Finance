import { NextResponse } from 'next/server';
import { createRateSchema } from '@/lib/schemas/accounts';
import { handler } from '@/server/http';
import { createRate, listRates } from '@/server/modules/fx/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ user }) => NextResponse.json({ data: await listRates(user!) }));

export const POST = handler(
  async ({ request, user, meta }) => {
    const input = createRateSchema.parse(await request.json());
    return NextResponse.json(await createRate(user!, input, meta), { status: 201 });
  },
  { permission: 'fx.manage' },
);
