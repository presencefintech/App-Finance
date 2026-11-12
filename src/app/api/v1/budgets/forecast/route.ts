import { NextResponse } from 'next/server';
import { AppError } from '@/server/errors';
import { handler } from '@/server/http';
import { treasuryForecast } from '@/server/modules/budgets/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ request, user }) => {
  const q = new URL(request.url).searchParams;
  const entityId = q.get('entityId');
  if (!entityId) throw new AppError('VALIDATION_ERROR', 400, 'entityId requis');
  return NextResponse.json({ data: await treasuryForecast(user!, entityId, Number(q.get('weeks') ?? 4) || 4) });
});
