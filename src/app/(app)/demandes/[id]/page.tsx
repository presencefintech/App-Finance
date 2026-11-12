import { notFound, redirect } from 'next/navigation';
import { Forbidden } from '@/components/forbidden';
import { canAccessPath } from '@/lib/navigation';
import { Card, CardTitle } from '@/components/ui/card';
import { FundRequestStatus } from '@/components/fund-request-status';
import { FundRequestActions } from '@/components/fund-request-actions';
import { AttachmentUploader } from '@/components/attachment-uploader';
import { Money } from '@/components/money';
import { FUND_REQUEST_STATUS, type FundRequestStatusKey } from '@/lib/labels';
import { availableActions } from '@/lib/fund-request-actions';
import { formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { getFundRequest } from '@/server/modules/fund-requests/service';

export default async function DemandeDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath('/demandes', user.roles)) return <Forbidden />;
  const { id } = await params;
  let req;
  try {
    req = await getFundRequest(user, id);
  } catch (e) {
    if (e instanceof AppError && e.httpStatus === 404) notFound();
    throw e;
  }
  const raw = await prisma.fundRequest.findUniqueOrThrow({ where: { id }, select: { approvedById: true } });
  const entity = await prisma.entity.findUniqueOrThrow({ where: { id: req.entityId }, select: { name: true } });
  const roles = user.roles.filter((r) => r.entityId === req.entityId).map((r) => r.role);
  const actions = availableActions({
    status: req.status, userId: user.id, requesterId: req.requesterId, approvedById: raw.approvedById, roles,
  });
  const canUpload =
    (req.requesterId === user.id || roles.includes('CONTROLLER')) && !['CLOSED', 'CANCELLED', 'REJECTED'].includes(req.status);

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-muted">{req.reference} · {entity.name}</p>
            <h1 className="mt-1 text-xl font-semibold">Demande de fonds</h1>
            <p className="text-sm text-muted">Par {req.requesterName}</p>
          </div>
          <div className="text-right">
            <Money value={req.amount} currency={req.currency} className="text-2xl font-semibold" />
            <div className="mt-1"><FundRequestStatus status={req.status} /></div>
          </div>
        </div>
        <p className="mt-4 whitespace-pre-wrap text-sm">{req.purpose}</p>
        <FundRequestActions
          id={req.id} actions={actions} entityId={req.entityId} amount={req.amount} currency={req.currency}
          reference={req.reference}
        />
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardTitle>Historique</CardTitle>
          <ol className="relative space-y-4 border-l border-border pl-5 text-sm">
            {req.events.map((e) => (
              <li key={e.id}>
                <span className="absolute -left-1.5 mt-1.5 size-3 rounded-full bg-primary" />
                <div className="font-medium">{FUND_REQUEST_STATUS[e.toStatus as FundRequestStatusKey]?.label ?? e.toStatus}</div>
                <div className="text-xs text-muted">{e.actorName} · {formatDateTime(e.at)}</div>
                {e.comment && <div className="mt-1 text-muted">« {e.comment} »</div>}
              </li>
            ))}
          </ol>
        </Card>

        <Card>
          <CardTitle>Pièces jointes</CardTitle>
          <ul className="mb-4 space-y-2 text-sm">
            {req.attachments.length === 0 && <li className="text-muted">Aucune pièce.</li>}
            {req.attachments.map((a) => (
              <li key={a.id} className="flex justify-between gap-2">
                <a className="truncate text-primary hover:underline" href={`/api/v1/attachments/${a.id}/file`} target="_blank" rel="noreferrer">{a.fileName}</a>
                <span className="shrink-0 text-xs text-muted">{Math.max(1, Math.round(a.size / 1024))} Ko</span>
              </li>
            ))}
          </ul>
          {canUpload && <AttachmentUploader targetType="fundRequest" targetId={req.id} />}
        </Card>
      </div>
    </div>
  );
}
