import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { getAdvance } from '@/server/modules/advances/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ user, params }) => NextResponse.json(await getAdvance(user!, params.id!)));
