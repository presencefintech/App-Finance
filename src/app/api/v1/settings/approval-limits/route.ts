import { NextResponse } from 'next/server';
import { z } from 'zod';
import { amountSchema, currencySchema } from '@/lib/schemas/common';
import { AppError } from '@/server/errors';
import { handler } from '@/server/http';
import { listApprovalLimits, setApprovalLimit } from '@/server/modules/settings/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(
  async ({ request, user }) => {
    const entityId = new URL(request.url).searchParams.get('entityId');
    if (!entityId) throw new AppError('VALIDATION_ERROR', 400, 'entityId requis');
    return NextResponse.json({ data: await listApprovalLimits(user!, entityId) });
  },
  { permission: 'settings.manage' },
);

const bodySchema = z.object({
  entityId: z.string().min(1), role: z.enum(['CONTROLLER', 'DIRECTOR']), currency: currencySchema, maxAmount: amountSchema,
});

export const PUT = handler(
  async ({ request, user, meta }) => NextResponse.json(await setApprovalLimit(user!, bodySchema.parse(await request.json()), meta)),
  { permission: 'settings.manage', idempotent: true },
);
