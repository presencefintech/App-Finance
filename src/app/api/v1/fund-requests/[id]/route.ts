import { NextResponse } from 'next/server';
import { updateFundRequestSchema } from '@/lib/schemas/fund-requests';
import { handler } from '@/server/http';
import { getFundRequest, updateFundRequest } from '@/server/modules/fund-requests/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ user, params }) => NextResponse.json(await getFundRequest(user!, params.id!)));

export const PATCH = handler(async ({ request, user, params, meta }) => {
  const input = updateFundRequestSchema.parse(await request.json());
  return NextResponse.json(await updateFundRequest(user!, params.id!, input, meta));
});
