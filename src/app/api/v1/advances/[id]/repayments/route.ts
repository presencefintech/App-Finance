import { NextResponse } from 'next/server';
import { repaymentSchema } from '@/lib/schemas/advances';
import { handler } from '@/server/http';
import { repayAdvance } from '@/server/modules/advances/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(
  async ({ request, user, params, meta }) =>
    NextResponse.json(await repayAdvance(user!, params.id!, repaymentSchema.parse(await request.json()), meta), { status: 201 }),
  { permission: 'advance.manage', idempotent: true },
);
