import { handler } from '@/server/http';
import { readAttachmentFile } from '@/server/modules/attachments/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ user, params }) => {
  const f = await readAttachmentFile(user!, params.id!);
  return new Response(new Uint8Array(f.bytes), {
    headers: {
      'Content-Type': f.mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(f.fileName)}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
