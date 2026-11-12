import { NextResponse } from 'next/server';
import { listSessions } from '@/server/auth';
import { handler } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ user }) => NextResponse.json({ data: await listSessions(user!) }));
