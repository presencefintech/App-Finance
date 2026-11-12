import { NextResponse } from 'next/server';
import { commentSchema, disburseSchema, rejectSchema } from '@/lib/schemas/fund-requests';
import { AppError } from '@/server/errors';
import { handler } from '@/server/http';
import * as svc from '@/server/modules/fund-requests/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /fund-requests/:id/{submit|review|approve|reject|escalate|disburse|confirm-receipt|justify|close|cancel} */
export const POST = handler(
  async ({ request, user, params, meta }) => {
    const id = params.id!;
    const body = request.headers.get('content-length') === '0' ? {} : await request.json().catch(() => ({}));
    const actor = user!;
    switch (params.action) {
      case 'submit': return NextResponse.json(await svc.submitFundRequest(actor, id, meta));
      case 'review': return NextResponse.json(await svc.reviewFundRequest(actor, id, meta));
      case 'approve': return NextResponse.json(await svc.approveFundRequest(actor, id, commentSchema.parse(body).comment, meta));
      case 'escalate': return NextResponse.json(await svc.escalateFundRequest(actor, id, commentSchema.parse(body).comment, meta));
      case 'reject': return NextResponse.json(await svc.rejectFundRequest(actor, id, rejectSchema.parse(body).comment, meta));
      case 'disburse': return NextResponse.json(await svc.disburseFundRequest(actor, id, disburseSchema.parse(body), meta));
      case 'confirm-receipt': return NextResponse.json(await svc.confirmReceipt(actor, id, meta));
      case 'justify': return NextResponse.json(await svc.justifyFundRequest(actor, id, commentSchema.parse(body).comment, meta));
      case 'close': return NextResponse.json(await svc.closeFundRequest(actor, id, commentSchema.parse(body).comment, meta));
      case 'cancel': return NextResponse.json(await svc.cancelFundRequest(actor, id, meta));
      default: throw new AppError('NOT_FOUND', 404, 'Action inconnue');
    }
  },
  { idempotent: true },
);
