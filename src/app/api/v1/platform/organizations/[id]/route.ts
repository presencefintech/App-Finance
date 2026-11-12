import { NextResponse } from 'next/server';
import { setOrganizationActiveSchema } from '@/lib/schemas/platform';
import { handler } from '@/server/http';
import { setOrganizationActive } from '@/server/modules/platform/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = handler(
  async ({ request, user, params, meta }) => {
    const { isActive } = setOrganizationActiveSchema.parse(await request.json());
    return NextResponse.json(await setOrganizationActive(user!, params.id!, isActive, meta));
  },
  { platform: true },
);
