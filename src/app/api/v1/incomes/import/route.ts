import { NextResponse } from 'next/server';
import { importIncomesSchema } from '@/lib/schemas/operations';
import { handler } from '@/server/http';
import { importIncomesCsv } from '@/server/modules/incomes/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(
  async ({ request, user, meta }) => {
    const input = importIncomesSchema.parse(await request.json());
    return NextResponse.json(await importIncomesCsv(user!, input, meta), { status: 201 });
  },
  { permission: 'transaction.record', idempotent: true },
);
