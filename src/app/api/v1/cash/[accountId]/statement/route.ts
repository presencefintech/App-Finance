import { AppError } from '@/server/errors';
import { fileResponse, parseDay, PDF_MIME } from '@/server/files';
import { handler } from '@/server/http';
import { buildCashStatement } from '@/server/modules/registers/service';
import { renderPdf } from '@/server/modules/reports/render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /cash/:accountId/statement?from&to — état de caisse (PDF) par jour ou période. */
export const GET = handler(
  async ({ request, user, params }) => {
    const q = new URL(request.url).searchParams;
    const day = parseDay(q.get('date'), 'start');
    const from = day ?? parseDay(q.get('from'), 'start');
    const to = day ? parseDay(q.get('date'), 'end') : parseDay(q.get('to'), 'end');
    if (!from || !to) throw new AppError('VALIDATION_ERROR', 400, 'Indiquez date=AAAA-MM-JJ ou from/to');
    const doc = await buildCashStatement(user!, params.accountId!, from, to);
    return fileResponse(await renderPdf(doc), `etat-de-caisse-${from.toISOString().slice(0, 10)}.pdf`, PDF_MIME);
  },
  { permission: 'account.read' },
);
