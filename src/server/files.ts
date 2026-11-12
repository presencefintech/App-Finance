import 'server-only';
import { AppError } from './errors';

export function fileResponse(body: Buffer, fileName: string, mime: string): Response {
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${fileName.replace(/[^\w.\-]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const PDF_MIME = 'application/pdf';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** "YYYY-MM-DD" (jour local Africa/Lubumbashi) → début ou fin de journée en UTC. */
export function parseDay(value: string | null, edge: 'start' | 'end'): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError('VALIDATION_ERROR', 400, 'Date invalide (AAAA-MM-JJ)');
  const d = new Date(edge === 'start' ? `${value}T00:00:00+02:00` : `${value}T23:59:59.999+02:00`);
  if (Number.isNaN(d.getTime())) throw new AppError('VALIDATION_ERROR', 400, 'Date invalide');
  return d;
}

export type Format = 'json' | 'pdf' | 'xlsx';
export function parseFormat(value: string | null, fallback: Format): Format {
  return value === 'json' || value === 'pdf' || value === 'xlsx' ? value : fallback;
}
