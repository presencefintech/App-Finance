import { notFound, redirect } from 'next/navigation';
import { Forbidden } from '@/components/forbidden';
import { canAccessPath } from '@/lib/navigation';
import { Card, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Money } from '@/components/money';
import { RepayForm } from '@/components/repay-form';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { getCurrentUser } from '@/server/auth';
import { AppError } from '@/server/errors';
import { getAdvance } from '@/server/modules/advances/service';

export default async function AvanceDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath('/avances', user.roles)) return <Forbidden />;
  const { id } = await params;
  let adv;
  try {
    adv = await getAdvance(user, id);
  } catch (e) {
    if (e instanceof AppError && e.httpStatus === 404) notFound();
    throw e;
  }
  const canRepay =
    (adv.status === 'OPEN' || adv.status === 'PARTIALLY_REPAID') &&
    can(user.roles, 'advance.manage', adv.borrowerEntityId) && can(user.roles, 'advance.manage', adv.lenderEntityId);

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <Card>
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono text-xs text-muted">{adv.reference}</p>
            <h1 className="mt-1 text-xl font-semibold">{adv.lenderName} → {adv.borrowerName}</h1>
            <p className="text-sm text-muted">{formatDate(adv.date)} · {adv.description}</p>
          </div>
          <StatusBadge tone={adv.status === 'REPAID' ? 'success' : adv.status === 'CANCELLED' ? 'neutral' : 'warning'}>{adv.status}</StatusBadge>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <div><dt className="text-xs text-muted">Montant avancé</dt><dd><Money value={adv.amount} currency={adv.currency} className="font-semibold" /></dd></div>
          <div><dt className="text-xs text-muted">Remboursé</dt><dd><Money value={adv.repaid} currency={adv.currency} className="font-semibold" /></dd></div>
          <div><dt className="text-xs text-muted">Restant dû</dt><dd><Money value={adv.remaining} currency={adv.currency} className="font-semibold" /></dd></div>
        </dl>
        {adv.overdue && <p className="mt-3 text-sm text-danger">⚠ Avance ouverte depuis {adv.ageDays} jours.</p>}
      </Card>

      <Card>
        <CardTitle>Remboursements</CardTitle>
        <ul className="divide-y divide-border text-sm">
          {adv.repayments.length === 0 && <li className="py-4 text-muted">Aucun remboursement.</li>}
          {adv.repayments.map((r) => (
            <li key={r.id} className="flex justify-between py-2">
              <span>{formatDate(r.date)} · <span className="font-mono text-xs">{r.reference}</span> {r.reversed && <StatusBadge tone="warning">Contre-passé</StatusBadge>}</span>
              <Money value={r.amount} currency={r.currency} className={r.reversed ? 'text-muted line-through' : ''} />
            </li>
          ))}
        </ul>
      </Card>

      {canRepay && <RepayForm advanceId={adv.id} currency={adv.currency} remaining={adv.remaining} borrowerEntityId={adv.borrowerEntityId} lenderEntityId={adv.lenderEntityId} />}
    </div>
  );
}
