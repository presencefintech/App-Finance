import { NextResponse } from 'next/server';
import { AppError } from '@/server/errors';
import { handler } from '@/server/http';
import { previewStatement } from '@/server/modules/reconciliation/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Étape 1 : lit le fichier (CSV/XLSX) et renvoie colonnes, aperçu et mapping mémorisé. N'écrit rien. */
export const POST = handler(
  async ({ request, user }) => {
    const form = await request.formData();
    const file = form.get('file');
    const accountId = String(form.get('accountId') ?? '');
    if (!(file instanceof File) || !accountId) throw new AppError('VALIDATION_ERROR', 400, 'Fichier et compte requis');
    return NextResponse.json(await previewStatement(user!, accountId, file.name, Buffer.from(await file.arrayBuffer())));
  },
  { permission: 'reconciliation.manage' },
);
