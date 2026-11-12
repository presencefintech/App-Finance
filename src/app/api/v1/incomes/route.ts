import { NextResponse } from 'next/server';
import { createIncomeSchema, listOperationsSchema } from '@/lib/schemas/operations';
import { handler } from '@/server/http';
import { createIncome, listIncomes } from '@/server/modules/incomes/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ request, user }) => {
  const q = listOperationsSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return NextResponse.json(await listIncomes(user!, q));
});

export const POST = handler(
  async ({ request, user, meta }) => {
    const input = createIncomeSchema.parse(await request.json());
    return NextResponse.json(await createIncome(user!, input, meta), { status: 201 });
  },
  { permission: 'transaction.record', idempotent: true },
);
