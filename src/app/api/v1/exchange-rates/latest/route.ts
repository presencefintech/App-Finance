import { NextResponse } from 'next/server';
import { currencySchema } from '@/lib/schemas/common';
import { handler } from '@/server/http';
import { latestRate } from '@/server/modules/fx/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ request, user }) => {
  const q = new URL(request.url).searchParams;
  const base = currencySchema.parse(q.get('base'));
  const quote = currencySchema.parse(q.get('quote'));
  return NextResponse.json(await latestRate(user!, base, quote));
});
