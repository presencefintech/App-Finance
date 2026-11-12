import { NextResponse } from 'next/server';
import { createBudgetSchema } from '@/lib/schemas/budgets';
import { handler } from '@/server/http';
import { createBudget, listBudgets } from '@/server/modules/budgets/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ request, user }) =>
  NextResponse.json({ data: await listBudgets(user!, new URL(request.url).searchParams.get('entityId') ?? undefined) }),
);

export const POST = handler(
  async ({ request, user, meta }) =>
    NextResponse.json(await createBudget(user!, createBudgetSchema.parse(await request.json()), meta), { status: 201 }),
  { permission: 'budget.manage', idempotent: true },
);
