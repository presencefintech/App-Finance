import { NextResponse } from 'next/server';
import { AppError } from '@/server/errors';
import { fileResponse, parseDay, parseFormat, PDF_MIME, XLSX_MIME } from '@/server/files';
import { handler } from '@/server/http';
import { resolveEntityIds } from '@/server/modules/entities/service';
import { buildReport, defaultReportRange, REPORT_TYPES, type ReportType } from '@/server/modules/reports/builders';
import { renderPdf, renderXlsx } from '@/server/modules/reports/render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /reports/:type?entity&from&to&format=json|pdf|xlsx  (type = daily | weekly | monthly) */
export const GET = handler(
  async ({ request, user, params }) => {
    const type = params.type as ReportType;
    if (!REPORT_TYPES.includes(type)) throw new AppError('NOT_FOUND', 404, 'Type de rapport inconnu');
    const q = new URL(request.url).searchParams;
    const def = defaultReportRange(type);
    const from = parseDay(q.get('from'), 'start') ?? def.from;
    const to = parseDay(q.get('to'), 'end') ?? def.to;
    if (to < from) throw new AppError('VALIDATION_ERROR', 400, 'La fin de période précède le début');
    const doc = await buildReport(user!, type, await resolveEntityIds(user!, q.get('entity')), from, to);
    const format = parseFormat(q.get('format'), 'json');
    const base = `rapport-${type}-${from.toISOString().slice(0, 10)}`;
    if (format === 'pdf') return fileResponse(await renderPdf(doc), `${base}.pdf`, PDF_MIME);
    if (format === 'xlsx') return fileResponse(await renderXlsx(doc), `${base}.xlsx`, XLSX_MIME);
    return NextResponse.json(doc);
  },
  { permission: 'report.read' },
);
