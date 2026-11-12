import { NextResponse } from 'next/server';
import { createExpenseSchema, listOperationsSchema } from '@/lib/schemas/operations';
import { handler } from '@/server/http';
import { createExpense, listExpenses } from '@/server/modules/expenses/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ request, user }) => {
  const q = listOperationsSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return NextResponse.json(await listExpenses(user!, q));
});

export const POST = handler(
  async ({ request, user, meta }) => {
    const input = createExpenseSchema.parse(await request.json());
    return NextResponse.json(await createExpense(user!, input, meta), { status: 201 });
  },
  { permission: 'transaction.record', idempotent: true },
);
