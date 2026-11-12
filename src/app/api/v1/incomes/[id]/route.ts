import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { getIncome } from '@/server/modules/incomes/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ user, params }) => NextResponse.json(await getIncome(user!, params.id!)));
