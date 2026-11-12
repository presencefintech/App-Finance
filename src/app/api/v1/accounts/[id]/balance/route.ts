import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { getBalance } from '@/server/modules/accounts/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(
  async ({ request, user, params }) => {
    const at = new URL(request.url).searchParams.get('at');
    const date = at ? new Date(at) : undefined;
    return NextResponse.json(await getBalance(user!, params.id!, date && !Number.isNaN(date.getTime()) ? date : undefined));
  },
  { permission: 'account.read' },
);
