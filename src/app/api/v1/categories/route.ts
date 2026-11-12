import { NextResponse } from 'next/server';
import { referentialSchema } from '@/lib/schemas/operations';
import { handler } from '@/server/http';
import { createCategory, listCategories } from '@/server/modules/referentials/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ request, user }) =>
  NextResponse.json({ data: await listCategories(user!, new URL(request.url).searchParams.get('entityId') ?? undefined) }),
);

export const POST = handler(
  async ({ request, user, meta }) => {
    const i = referentialSchema.parse(await request.json());
    return NextResponse.json(
      await createCategory(user!, { entityId: i.entityId, kind: i.kind ?? 'EXPENSE', name: i.name }, meta),
      { status: 201 },
    );
  },
  { permission: 'settings.manage' },
);
