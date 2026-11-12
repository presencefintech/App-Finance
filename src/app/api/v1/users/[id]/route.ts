import { NextResponse } from 'next/server';
import { updateUserSchema } from '@/lib/schemas/users';
import { handler } from '@/server/http';
import { updateUser } from '@/server/modules/users/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = handler(
  async ({ request, user, params, meta }) => {
    const input = updateUserSchema.parse(await request.json());
    return NextResponse.json(await updateUser(user!, params.id!, input, meta));
  },
  { permission: 'user.manage' },
);
