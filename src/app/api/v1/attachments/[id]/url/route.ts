import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { getAttachmentUrl } from '@/server/modules/attachments/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ user, params, meta }) =>
  NextResponse.json(await getAttachmentUrl(user!, params.id!, meta)),
);
