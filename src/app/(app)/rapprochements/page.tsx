import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatementImport } from '@/components/statement-import';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { getCurrentUser } from '@/server/auth';
import { getSelectedEntities } from '@/server/entity-selection';
import { listAccounts } from '@/server/modules/accounts/service';
import { listStatements } from '@/server/modules/reconciliation/service';

const STATUS = {
  IN_PROGRESS: { label: 'En cours', tone: 'warning' },
  SUBMITTED: { label: 'Soumis', tone: 'warning' },
  VALIDATED: { label: 'Validé', tone: 'success' },
} as const;

export default async function RapprochementsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { entities } = await getSelectedEntities(user);
  const allowed = entities.filter((e) => can(user.roles, 'reconciliation.manage', e.id));
  if (allowed.length === 0) return <Card>Le rapprochement bancaire est réservé à la contrôleuse financière.</Card>;

  const [statements, banks] = await Promise.all([
    listStatements(user),
    listAccounts(user, { entityIds: allowed.map((e) => e.id), type: 'BANK' }),
  ]);
  const accountName = new Map(banks.map((b) => [b.id, `${b.name} (${b.currency})`]));

  return (
    <div className="grid gap-6">
      {allowed.map((entity) => {
        const rows = statements.filter((s) => s.entityId === entity.id);
        return (
          <Card key={entity.id}>
            <CardTitle>Rapprochements — {entity.name}</CardTitle>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted"><tr><th className="pb-2">Compte</th><th>Période</th><th>Lignes</th><th>Rapprochées</th><th>À traiter</th><th>Statut</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {rows.length === 0 && <tr><td colSpan={6} className="py-6 text-muted">Aucun relevé importé.</td></tr>}
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td className="py-2 pr-3"><Link href={`/rapprochements/${s.id}`} className="font-medium hover:text-primary">{accountName.get(s.accountId) ?? s.fileName}</Link></td>
                      <td className="pr-3">{formatDate(s.periodStart)} → {formatDate(s.periodEnd)}</td>
                      <td className="pr-3">{s.total}</td>
                      <td className="pr-3">{s.matched}</td>
                      <td className="pr-3">{s.pending}</td>
                      <td><StatusBadge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</StatusBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
      <StatementImport accounts={banks.filter((b) => b.isActive).map((b) => ({ id: b.id, name: `${b.name} (${b.currency})` }))} />
    </div>
  );
}
