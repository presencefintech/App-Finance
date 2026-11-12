import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { getStatement } from '@/server/modules/reconciliation/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ user, params }) => NextResponse.json(await getStatement(user!, params.id!)), {
  permission: 'reconciliation.manage',
});
