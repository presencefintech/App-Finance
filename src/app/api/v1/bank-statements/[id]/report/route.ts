import { NextResponse } from 'next/server';
import { fileResponse, parseFormat, PDF_MIME, XLSX_MIME } from '@/server/files';
import { handler } from '@/server/http';
import { buildReconciliationReport } from '@/server/modules/reconciliation/report';
import { renderPdf, renderXlsx } from '@/server/modules/reports/render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /bank-statements/:id/report?format=pdf|xlsx|json — état de rapprochement. */
export const GET = handler(
  async ({ request, user, params }) => {
    const doc = await buildReconciliationReport(user!, params.id!);
    const format = parseFormat(new URL(request.url).searchParams.get('format'), 'pdf');
    if (format === 'json') return NextResponse.json(doc);
    if (format === 'xlsx') return fileResponse(await renderXlsx(doc), `rapprochement-${params.id!.slice(0, 8)}.xlsx`, XLSX_MIME);
    return fileResponse(await renderPdf(doc), `rapprochement-${params.id!.slice(0, 8)}.pdf`, PDF_MIME);
  },
  { permission: 'reconciliation.manage' },
);
