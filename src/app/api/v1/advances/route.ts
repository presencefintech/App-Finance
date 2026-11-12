import { NextResponse } from 'next/server';
import { createAdvanceSchema } from '@/lib/schemas/advances';
import { handler } from '@/server/http';
import { createManualAdvance, listAdvances } from '@/server/modules/advances/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ request, user }) => {
  const q = new URL(request.url).searchParams;
  return NextResponse.json({
    data: await listAdvances(user!, { status: q.get('status') ?? undefined, entityId: q.get('entityId') ?? undefined }),
  });
});

export const POST = handler(
  async ({ request, user, meta }) =>
    NextResponse.json(await createManualAdvance(user!, createAdvanceSchema.parse(await request.json()), meta), { status: 201 }),
  { permission: 'advance.manage', idempotent: true },
);
