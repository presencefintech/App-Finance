import Link from 'next/link';
import { Forbidden } from '@/components/forbidden';
import { canAccessPath } from '@/lib/navigation';
import { redirect } from 'next/navigation';
import { Card, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { AdvanceForm } from '@/components/advance-form';
import { Money } from '@/components/money';
import { SegmentedBar } from '@/components/charts/meter';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { getCurrentUser } from '@/server/auth';
import { getSelectedEntities } from '@/server/entity-selection';
import { listAdvances, openAdvanceTotals } from '@/server/modules/advances/service';
import { listAllEntityNames } from '@/server/modules/entities/service';

const STATUS = {
  OPEN: { label: 'Ouverte', tone: 'warning' },
  PARTIALLY_REPAID: { label: 'Partiellement remboursée', tone: 'warning' },
  REPAID: { label: 'Remboursée', tone: 'success' },
  CANCELLED: { label: 'Annulée', tone: 'neutral' },
} as const;

export default async function AvancesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath('/avances', user.roles)) return <Forbidden />;
  const { entities } = await getSelectedEntities(user);
  const allAdvances = await listAdvances(user);
  const manager = entities.filter((e) => can(user.roles, 'advance.manage', e.id));
  const allEntities = manager.length ? await listAllEntityNames() : [];

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 xl:grid-cols-2">
        {await Promise.all(
          entities.map(async (entity) => {
            const totals = await openAdvanceTotals(user, entity.id).catch(() => null);
            const rows = allAdvances.filter((a) => a.lenderEntityId === entity.id || a.borrowerEntityId === entity.id);
            return (
              <Card key={entity.id}>
                <CardTitle>Avances — {entity.name}</CardTitle>
                {totals && (
                  <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl border border-border p-3">
                      <div className="text-xs text-muted">Créances (à recevoir)</div>
                      {totals.receivable.map((t) => <div key={t.currency}><Money value={t.total} currency={t.currency} className="font-semibold" /></div>)}
                    </div>
                    <div className="rounded-xl border border-border p-3">
                      <div className="text-xs text-muted">Dettes (à rembourser)</div>
                      {totals.payable.map((t) => <div key={t.currency}><Money value={t.total} currency={t.currency} className="font-semibold" /></div>)}
                    </div>
                    {totals.overdueCount > 0 && <p className="col-span-2 text-danger">⚠ {totals.overdueCount} avance(s) ouverte(s) depuis plus de 30 jours</p>}
                  </div>
                )}
                <ul className="divide-y divide-border text-sm">
                  {rows.length === 0 && <li className="py-4 text-muted">Aucune avance.</li>}
                  {rows.map((a) => {
                    const lender = a.lenderEntityId === entity.id;
                    return (
                      <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                        <div>
                          <Link href={`/avances/${a.id}`} className="font-mono text-xs hover:text-primary">{a.reference}</Link>
                          <div>{lender ? `Avancé à ${a.borrowerName}` : `Reçu de ${a.lenderName}`} · {formatDate(a.date)}</div>
                          <div className="mt-1 flex items-center gap-2">
                            <StatusBadge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</StatusBadge>
                            {a.overdue && <StatusBadge tone="danger">&gt; 30 jours</StatusBadge>}
                          </div>
                        </div>
                        <div className="w-40 text-right">
                          <div className="mb-1"><SegmentedBar label={`Remboursé ${a.repaid} sur ${a.amount} ${a.currency}`} parts={[{ name: 'Remboursé', value: Number(a.repaid), color: 'var(--series-1)' }, { name: 'Restant dû', value: Number(a.remaining), color: 'var(--series-4)' }]} /></div>
                          <div className="text-xs text-muted">Restant dû</div>
                          <Money value={a.remaining} currency={a.currency} className="font-semibold" />
                          <div className="text-xs text-muted">sur <Money value={a.amount} currency={a.currency} /></div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          }),
        )}
      </div>
      {manager.length > 0 && <AdvanceForm lenderEntities={manager} entities={allEntities} />}
    </div>
  );
}
