import { NextResponse } from 'next/server';
import { createUserSchema } from '@/lib/schemas/users';
import { handler } from '@/server/http';
import { createUser, listUsers } from '@/server/modules/users/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ user }) => NextResponse.json({ data: await listUsers(user!) }), {
  permission: 'user.manage',
});

export const POST = handler(
  async ({ request, user, meta }) => {
    const input = createUserSchema.parse(await request.json());
    return NextResponse.json(await createUser(user!, input, meta), { status: 201 });
  },
  { permission: 'user.manage' },
);
