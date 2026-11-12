import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { listEntities } from '@/server/modules/entities/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ user }) => NextResponse.json({ data: await listEntities(user!) }));
