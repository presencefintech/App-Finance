import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { dashboard } from '@/server/modules/dashboard/service';
import { resolveEntityIds } from '@/server/modules/entities/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /dashboard?entity=SEC|ECOLE|ALL — une entrée par entité, jamais fusionnées. */
export const GET = handler(async ({ request, user }) => {
  const ids = await resolveEntityIds(user!, new URL(request.url).searchParams.get('entity'));
  return NextResponse.json({ data: await dashboard(user!, ids) });
});
