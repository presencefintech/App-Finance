import { NextResponse } from 'next/server';
import { AppError } from '@/server/errors';
import { fileResponse, parseDay, parseFormat, PDF_MIME, XLSX_MIME } from '@/server/files';
import { handler } from '@/server/http';
import { resolveEntityIds } from '@/server/modules/entities/service';
import { buildRegister, defaultRange, REGISTER_TYPES, type RegisterType } from '@/server/modules/registers/service';
import { renderPdf, renderXlsx } from '@/server/modules/reports/render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /registers/:type?entity=<code>&from&to&format=pdf|xlsx|json — un registre par entité. */
export const GET = handler(
  async ({ request, user, params }) => {
    const type = params.type as RegisterType;
    if (!REGISTER_TYPES.includes(type)) throw new AppError('NOT_FOUND', 404, 'Registre inconnu');
    const q = new URL(request.url).searchParams;
    const entity = q.get('entity');
    if (!entity || entity === 'ALL') {
      throw new AppError('VALIDATION_ERROR', 400, 'Choisissez une entité (code) : un registre est propre à une entité');
    }
    const [entityId] = await resolveEntityIds(user!, entity);
    if (!entityId) throw new AppError('NOT_FOUND', 404, 'Entité introuvable');
    const def = defaultRange(type);
    const from = parseDay(q.get('from'), 'start') ?? def.from;
    const to = parseDay(q.get('to'), 'end') ?? def.to;
    const doc = await buildRegister(user!, type, entityId, from, to);
    const format = parseFormat(q.get('format'), 'pdf');
    const base = `registre-${type}-${entity}-${from.toISOString().slice(0, 10)}`;
    if (format === 'xlsx') return fileResponse(await renderXlsx(doc), `${base}.xlsx`, XLSX_MIME);
    if (format === 'json') return NextResponse.json(doc);
    return fileResponse(await renderPdf(doc), `${base}.pdf`, PDF_MIME);
  },
  { permission: 'account.read' },
);
