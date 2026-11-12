import { NextResponse } from 'next/server';
import { createOrganizationSchema } from '@/lib/schemas/platform';
import { handler } from '@/server/http';
import { createOrganization, listOrganizations } from '@/server/modules/platform/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ user }) => NextResponse.json({ data: await listOrganizations(user!) }), { platform: true });

export const POST = handler(
  async ({ request, user, meta }) =>
    NextResponse.json(await createOrganization(user!, createOrganizationSchema.parse(await request.json()), meta), { status: 201 }),
  { platform: true, idempotent: true },
);
