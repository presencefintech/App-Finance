import { NextResponse } from 'next/server';
import { createAccountSchema } from '@/lib/schemas/accounts';
import { handler } from '@/server/http';
import { createAccount, listAccounts } from '@/server/modules/accounts/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(
  async ({ request, user }) => {
    const q = new URL(request.url).searchParams;
    const entityId = q.get('entityId');
    const type = q.get('type');
    const data = await listAccounts(user!, {
      entityIds: entityId ? [entityId] : undefined,
      type: type === 'CASH' || type === 'BANK' ? type : undefined,
    });
    return NextResponse.json({ data });
  },
  { permission: 'account.read' },
);

export const POST = handler(
  async ({ request, user, meta }) => {
    const input = createAccountSchema.parse(await request.json());
    return NextResponse.json(await createAccount(user!, input, meta), { status: 201 });
  },
  { permission: 'account.manage', idempotent: true },
);
