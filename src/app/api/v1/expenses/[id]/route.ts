import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { getExpense } from '@/server/modules/expenses/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ user, params }) => NextResponse.json(await getExpense(user!, params.id!)));
