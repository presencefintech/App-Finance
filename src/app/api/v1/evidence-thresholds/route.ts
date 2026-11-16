import { NextResponse } from 'next/server';
import { evidenceThresholdSchema } from '@/lib/schemas/operations';
import { AppError } from '@/server/errors';
import { handler } from '@/server/http';
import { listEvidenceThresholds, setEvidenceThreshold } from '@/server/modules/attachments/evidence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Seuils de justificatif obligatoire d'une entité (lus par les formulaires de saisie et par les paramètres). */
export const GET = handler(async ({ request, user }) => {
  const entityId = new URL(request.url).searchParams.get('entityId');
  if (!entityId) throw new AppError('VALIDATION_ERROR', 400, 'entityId requis');
  return NextResponse.json({ data: await listEvidenceThresholds(user!, entityId) });
});

export const PUT = handler(
  async ({ request, user, meta }) =>
    NextResponse.json(await setEvidenceThreshold(user!, evidenceThresholdSchema.parse(await request.json()), meta)),
  { permission: 'settings.manage', idempotent: true },
);
