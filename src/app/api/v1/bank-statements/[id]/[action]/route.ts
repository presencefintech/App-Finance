import { NextResponse } from 'next/server';
import { validateStatementSchema } from '@/lib/schemas/reconciliation';
import { AppError } from '@/server/errors';
import { handler } from '@/server/http';
import { autoMatch, submitStatement, validateStatement } from '@/server/modules/reconciliation/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /bank-statements/:id/{auto-match|submit|validate} */
export const POST = handler(
  async ({ request, user, params, meta }) => {
    const id = params.id!;
    switch (params.action) {
      case 'auto-match': return NextResponse.json(await autoMatch(user!, id, meta));
      case 'submit': return NextResponse.json(await submitStatement(user!, id, meta));
      case 'validate': {
        const body = request.headers.get('content-length') === '0' ? {} : await request.json().catch(() => ({}));
        return NextResponse.json(await validateStatement(user!, id, validateStatementSchema.parse(body).note, meta));
      }
      default: throw new AppError('NOT_FOUND', 404, 'Action inconnue');
    }
  },
  { permission: 'reconciliation.manage', idempotent: true },
);
