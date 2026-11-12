import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handler } from '@/server/http';
import { getAppSettings, setAppSetting } from '@/server/modules/settings/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ user }) => NextResponse.json({ data: await getAppSettings(user!) }), {
  permission: 'settings.manage',
});

export const PUT = handler(
  async ({ request, user, meta }) => {
    const { key, value } = z.object({ key: z.string().min(1), value: z.string().max(20) }).parse(await request.json());
    return NextResponse.json(await setAppSetting(user!, key, value, meta));
  },
  { permission: 'settings.manage', idempotent: true },
);
