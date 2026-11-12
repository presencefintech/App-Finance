import { NextResponse } from 'next/server';
import { referentialUpdateSchema } from '@/lib/schemas/operations';
import { handler } from '@/server/http';
import { updateCategory } from '@/server/modules/referentials/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = handler(
  async ({ request, user, params, meta }) =>
    NextResponse.json(await updateCategory(user!, params.id!, referentialUpdateSchema.parse(await request.json()), meta)),
  { permission: 'settings.manage' },
);
