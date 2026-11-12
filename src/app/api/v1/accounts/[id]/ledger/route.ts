import { NextResponse } from 'next/server';
import { paginationSchema } from '@/lib/schemas/common';
import { handler } from '@/server/http';
import { getLedger } from '@/server/modules/accounts/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const parseDate = (v: string | null) => {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

export const GET = handler(
  async ({ request, user, params }) => {
    const q = new URL(request.url).searchParams;
    const { page, pageSize } = paginationSchema.parse(Object.fromEntries(q));
    return NextResponse.json(
      await getLedger(user!, params.id!, { from: parseDate(q.get('from')), to: parseDate(q.get('to')), page, pageSize }),
    );
  },
  { permission: 'account.read' },
);
