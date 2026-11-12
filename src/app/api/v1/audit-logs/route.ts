import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { listAuditLogs } from '@/server/modules/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const date = (v: string | null) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : undefined;
};

export const GET = handler(
  async ({ request, user }) => {
    const q = new URL(request.url).searchParams;
    return NextResponse.json({
      data: await listAuditLogs(user!, {
        actorId: q.get('actorId') ?? undefined, entityType: q.get('entityType') ?? undefined,
        action: q.get('action') ?? undefined, from: date(q.get('from')), to: date(q.get('to')),
      }),
    });
  },
  { permission: 'audit.read' },
);
