import { fileResponse, PDF_MIME } from '@/server/files';
import { handler } from '@/server/http';
import { buildTransactionDocument } from '@/server/modules/registers/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /documents/:txId.pdf — document imprimable d'une opération (montant en lettres, cases de signature). */
export const GET = handler(
  async ({ user, params }) => {
    const txId = (params.txId ?? '').replace(/\.pdf$/i, '');
    const { pdf, reference } = await buildTransactionDocument(user!, txId);
    return fileResponse(pdf, `${reference}.pdf`, PDF_MIME);
  },
  { permission: 'account.read' },
);
