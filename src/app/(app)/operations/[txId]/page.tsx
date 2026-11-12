import { notFound, redirect } from 'next/navigation';
import { Forbidden } from '@/components/forbidden';
import { canAccessPath } from '@/lib/navigation';
import { AttachmentUploader } from '@/components/attachment-uploader';
import { Money } from '@/components/money';
import { Card, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDate, formatDateTime } from '@/lib/format';
import { can } from '@/lib/permissions';
import { getCurrentUser } from '@/server/auth';
import { AppError } from '@/server/errors';
import { listForTransaction } from '@/server/modules/attachments/service';
import { getTransactionSummary } from '@/server/modules/registers/service';

export default async function OperationPage({ params }: { params: Promise<{ txId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath('/registres', user.roles)) return <Forbidden />;
  const { txId } = await params;
  let tx;
  try {
    tx = await getTransactionSummary(user, txId);
  } catch (e) {
    if (e instanceof AppError && e.httpStatus === 404) notFound();
    throw e;
  }
  const files = await listForTransaction(user, txId);
  const canUpload = can(user.roles, 'transaction.record', tx.entityId);

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-muted">{tx.reference}</p>
            <h1 className="mt-1 text-xl font-semibold">{tx.description}</h1>
            <p className="text-sm text-muted">{formatDate(tx.date)} · {tx.kind}</p>
          </div>
          {tx.status === 'REVERSED' && <StatusBadge tone="warning">Contre-passée</StatusBadge>}
        </div>
        <ul className="mt-4 divide-y divide-border text-sm">
          {tx.entries.map((e, i) => (
            <li key={i} className="flex justify-between py-2"><span>{e.account}</span><Money value={e.amount} currency={e.currency} className="font-semibold" /></li>
          ))}
        </ul>
        <a href={`/api/v1/documents/${tx.id}.pdf`} className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white">
          Télécharger le document à signer (PDF)
        </a>
      </Card>

      <Card>
        <CardTitle>Documents signés (scans)</CardTitle>
        <p className="mb-3 text-sm text-muted">
          Imprimez le document, faites-le signer, puis photographiez-le ici. JPEG, PNG ou PDF, 10 Mo maximum.
        </p>
        <ul className="mb-4 divide-y divide-border text-sm">
          {files.length === 0 && <li className="py-2 text-muted">Aucun scan déposé.</li>}
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 py-2">
              <a className="truncate text-primary hover:underline" href={`/api/v1/attachments/${f.id}/file`} target="_blank" rel="noreferrer">{f.fileName}</a>
              <span className="shrink-0 text-xs text-muted">{formatDateTime(f.uploadedAt)} · empreinte {f.sha256.slice(0, 8)}</span>
            </li>
          ))}
        </ul>
        {canUpload && <AttachmentUploader targetType="transaction" targetId={tx.id} kind="SIGNED_REGISTER" />}
      </Card>
    </div>
  );
}
