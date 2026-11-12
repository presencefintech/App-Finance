import Link from 'next/link';
import { Forbidden } from '@/components/forbidden';
import { canAccessPath } from '@/lib/navigation';
import { Card, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Money } from '@/components/money';
import { HBarChart } from '@/components/charts/hbar-chart';
import { AccountForm } from '@/components/account-form';
import type { AccountType } from '@/generated/prisma/enums';
import { can } from '@/lib/permissions';
import { getCurrentUser } from '@/server/auth';
import { getSelectedEntities } from '@/server/entity-selection';
import { listAccounts } from '@/server/modules/accounts/service';
import { redirect } from 'next/navigation';

/** Liste des caisses ou des banques, par entité (jamais fusionnées), un total par devise. */
export async function AccountsPage({ type }: { type: AccountType }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath(type === 'CASH' ? '/caisses' : '/banques', user.roles)) return <Forbidden />;
  const { entities } = await getSelectedEntities(user);
  const accounts = await listAccounts(user, { entityIds: entities.map((e) => e.id), type });
  const base = type === 'CASH' ? '/caisses' : '/banques';
  const label = type === 'CASH' ? 'Caisses' : 'Comptes bancaires';
  const manageable = entities.filter((e) => can(user.roles, 'account.manage', e.id));

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 xl:grid-cols-2">
        {entities.map((entity) => {
          const rows = accounts.filter((a) => a.entityId === entity.id);
          const totals = (['USD', 'CDF'] as const).map((cur) => ({
            cur,
            total: rows.filter((a) => a.currency === cur).reduce((s, a) => s + BigInt(a.balance.replace('.', '')), 0n),
          }));
          return (
            <Card key={entity.id}>
              <CardTitle>
                {label} — {entity.name}
              </CardTitle>
              {rows.length === 0 ? (
                <p className="py-6 text-sm text-muted">Aucun compte.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {rows.map((a) => (
                    <li key={a.id} className="flex items-center justify-between py-3">
                      <div>
                        <Link href={`${base}/${a.id}`} className="font-medium hover:text-primary">{a.name}</Link>
                        <div className="text-xs text-muted">
                          {a.bankName ?? ''} {a.accountNumberMasked ?? ''}
                          {!a.isActive && <StatusBadge tone="danger">Désactivé</StatusBadge>}
                        </div>
                      </div>
                      <Money value={a.balance} currency={a.currency} className="font-semibold" />
                    </li>
                  ))}
                </ul>
              )}
              {(['USD', 'CDF'] as const).map((cur) => {
                const items = rows.filter((a) => a.currency === cur && Number(a.balance) > 0).map((a) => ({ name: a.name, value: Number(a.balance) }));
                return items.length === 0 ? null : (
                  <div key={cur} className="mt-4 border-t border-border pt-3">
                    <h4 className="mb-2 text-xs font-medium text-muted">Soldes par compte — {cur}</h4>
                    <HBarChart label={`Soldes par compte en ${cur}`} currency={cur} items={items} />
                  </div>
                );
              })}
              <div className="mt-4 flex gap-4 border-t border-border pt-3 text-sm">
                {totals.map(({ cur, total }) => (
                  <div key={cur}>
                    <span className="text-xs text-muted">Total {cur} </span>
                    <Money value={centsToString(total)} currency={cur} className="font-semibold" />
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
      {manageable.length > 0 && <AccountForm type={type} entities={manageable} />}
    </div>
  );
}

/** Somme exacte en centimes (BigInt) : aucune arithmétique flottante sur les montants. */
function centsToString(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const s = abs.toString().padStart(3, '0');
  return `${neg ? '-' : ''}${s.slice(0, -2)}.${s.slice(-2)}`;
}
