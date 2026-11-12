import { NextResponse } from 'next/server';
import { updateAccountSchema } from '@/lib/schemas/accounts';
import { handler } from '@/server/http';
import { getAccount, updateAccount } from '@/server/modules/accounts/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ user, params }) => NextResponse.json(await getAccount(user!, params.id!)), {
  permission: 'account.read',
});

export const PATCH = handler(
  async ({ request, user, params, meta }) => {
    const input = updateAccountSchema.parse(await request.json());
    return NextResponse.json(await updateAccount(user!, params.id!, input, meta));
  },
  { permission: 'account.manage' },
);
