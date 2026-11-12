import { NextResponse } from 'next/server';
import { setRolesSchema } from '@/lib/schemas/users';
import { handler } from '@/server/http';
import { setUserRoles } from '@/server/modules/users/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = handler(
  async ({ request, user, params, meta }) => {
    const { roles } = setRolesSchema.parse(await request.json());
    return NextResponse.json(await setUserRoles(user!, params.id!, roles, meta));
  },
  { permission: 'user.manage' },
);
