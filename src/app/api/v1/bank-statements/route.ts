import { NextResponse } from 'next/server';
import { importStatementFieldsSchema } from '@/lib/schemas/reconciliation';
import { AppError } from '@/server/errors';
import { handler } from '@/server/http';
import { importStatement, listStatements } from '@/server/modules/reconciliation/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(
  async ({ request, user }) =>
    NextResponse.json({ data: await listStatements(user!, new URL(request.url).searchParams.get('accountId') ?? undefined) }),
  { permission: 'reconciliation.manage' },
);

export const POST = handler(
  async ({ request, user, meta }) => {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError('VALIDATION_ERROR', 400, 'Fichier manquant');
    const fields = importStatementFieldsSchema.parse({
      accountId: form.get('accountId'), mapping: form.get('mapping'), openingBalance: form.get('openingBalance'),
      closingBalance: form.get('closingBalance'), periodStart: form.get('periodStart') || undefined, periodEnd: form.get('periodEnd') || undefined,
    });
    const result = await importStatement(user!, { ...fields, fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, meta);
    return NextResponse.json(result, { status: 201 });
  },
  { permission: 'reconciliation.manage', idempotent: true },
);
