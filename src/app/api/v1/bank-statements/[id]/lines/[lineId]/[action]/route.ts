import { NextResponse } from 'next/server';
import { confirmLineSchema, createFromLineSchema, ignoreLineSchema } from '@/lib/schemas/reconciliation';
import { AppError } from '@/server/errors';
import { handler } from '@/server/http';
import { confirmLine, createFromLine, ignoreLine, unmatchLine } from '@/server/modules/reconciliation/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /bank-statements/:id/lines/:lineId/{confirm|ignore|create-transaction|unmatch} */
export const POST = handler(
  async ({ request, user, params, meta }) => {
    const { id, lineId } = { id: params.id!, lineId: params.lineId! };
    const body = request.headers.get('content-length') === '0' ? {} : await request.json().catch(() => ({}));
    switch (params.action) {
      case 'confirm': return NextResponse.json(await confirmLine(user!, id, lineId, confirmLineSchema.parse(body).entryId, meta));
      case 'ignore': return NextResponse.json(await ignoreLine(user!, id, lineId, ignoreLineSchema.parse(body).note, meta));
      case 'create-transaction': return NextResponse.json(await createFromLine(user!, id, lineId, createFromLineSchema.parse(body), meta), { status: 201 });
      case 'unmatch': return NextResponse.json(await unmatchLine(user!, id, lineId, meta));
      default: throw new AppError('NOT_FOUND', 404, 'Action inconnue');
    }
  },
  { permission: 'reconciliation.manage', idempotent: true },
);
