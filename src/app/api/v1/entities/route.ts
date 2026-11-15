import { NextResponse } from 'next/server';
import { createEntitySchema } from '@/lib/schemas/entities';
import { handler } from '@/server/http';
import { createEntity, listEntities } from '@/server/modules/entities/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(
  async ({ request, user, meta }) => {
    const input = createEntitySchema.parse(await request.json());
    return NextResponse.json(await createEntity(user!, input, meta), { status: 201 });
  },
  { permission: 'settings.manage', idempotent: true },
);

export const GET = handler(async ({ user }) => NextResponse.json({ data: await listEntities(user!) }));
