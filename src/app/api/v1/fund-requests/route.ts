import { NextResponse } from 'next/server';
import { createFundRequestSchema, listFundRequestsSchema } from '@/lib/schemas/fund-requests';
import { handler } from '@/server/http';
import { createFundRequest, listFundRequests } from '@/server/modules/fund-requests/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ request, user }) => {
  const q = listFundRequestsSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return NextResponse.json(await listFundRequests(user!, q));
});

export const POST = handler(
  async ({ request, user, meta }) => {
    const input = createFundRequestSchema.parse(await request.json());
    return NextResponse.json(await createFundRequest(user!, input, meta), { status: 201 });
  },
  { permission: 'fundRequest.create', idempotent: true },
);
