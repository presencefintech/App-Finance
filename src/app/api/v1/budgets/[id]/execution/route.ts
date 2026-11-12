import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { budgetExecution } from '@/server/modules/budgets/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ user, params }) => NextResponse.json(await budgetExecution(user!, params.id!)));
