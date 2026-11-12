import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handler } from '@/server/http';
import { AppError } from '@/server/errors';
import { MAX_UPLOAD_BYTES, uploadAttachment } from '@/server/modules/attachments/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fieldsSchema = z.object({
  targetType: z.enum(['fundRequest', 'transaction']),
  targetId: z.string().min(1),
  kind: z.enum(['RECEIPT', 'INVOICE', 'SIGNED_REGISTER', 'BANK_STATEMENT', 'OTHER']).default('RECEIPT'),
});

export const POST = handler(
  async ({ request, user, meta }) => {
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > MAX_UPLOAD_BYTES + 64 * 1024) throw new AppError('FILE_TOO_LARGE', 413, 'Fichier trop volumineux (10 Mo maximum)');
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError('VALIDATION_ERROR', 400, 'Fichier manquant');
    const fields = fieldsSchema.parse({
      targetType: form.get('targetType'), targetId: form.get('targetId'), kind: form.get('kind') ?? undefined,
    });
    const created = await uploadAttachment(
      user!,
      {
        target: { type: fields.targetType, id: fields.targetId }, kind: fields.kind,
        fileName: file.name, declaredType: file.type, bytes: Buffer.from(await file.arrayBuffer()),
      },
      meta,
    );
    return NextResponse.json(created, { status: 201 });
  },
  { idempotent: true },
);
