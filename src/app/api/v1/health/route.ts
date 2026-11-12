import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(
  async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new AppError('DB_UNREACHABLE', 503, 'Base de données injoignable');
    }
    return NextResponse.json({ status: 'ok', db: 'up' });
  },
  { auth: false },
);
