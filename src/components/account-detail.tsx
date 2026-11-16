import Link from 'next/link';
import { Forbidden } from '@/components/forbidden';
import { canAccessPath } from '@/lib/navigation';
import { notFound, redirect } from 'next/navigation';
import { Card, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Paperclip } from 'lucide-react';
import { AccountActions } from '@/components/account-actions';
import { Money } from '@/components/money';
import { ChartCard } from '@/components/charts/chart-card';
import { LineChart } from '@/components/charts/line-chart';
import { balanceHistory } from '@/server/modules/stats/service';
import { formatDate as fmtDay } from '@/lib/format';
import { PendingAction } from '@/components/pending-actions';
import { ReverseButton } from '@/components/reverse-button';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { getCurrentUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { getAccount, getLedger, listAccounts } from '@/server/modules/accounts/service';
import { evidenceCountsByTxId } from '@/server/modules/attachments/service';
import { listCashSessions } from '@/server/modules/cash/service';
import { listCategories } from '@/server/modules/referentials/service';
import { listWithdrawals } from '@/server/modules/transfers/service';

export async function AccountDetail({ id }: { id: string }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath('/caisses', user.roles)) return <Forbidden />;
  let account;
  try {
    account = await getAccount(user, id);
  } catch (e) {
    if (e instanceof AppError && e.httpStatus === 404) notFound();
    throw e;
  }
  const ledger = await getLedger(user, id, { page: 1, pageSize: 100 });
  const txIds = await prisma.financialTransaction.findMany({
    where: { reference: { in: ledger.data.map((r) => r.reference) } },
    select: { id: true, reference: true },
  });
  const idByRef = new Map(txIds.map((t) => [t.reference, t.id]));
  const evidence = await evidenceCountsByTxId(user, account.entityId, txIds.map((t) => t.id));
  const canReverse = can(user.roles, 'transaction.reverse', account.entityId);
  const canRecord = can(user.roles, 'transaction.record', account.entityId);
  const canClose = can(user.roles, 'cash.close', account.entityId);
  const isCashier = user.roles.some((r) => r.entityId === account.entityId && r.role === 'CASHIER');
  const canValidate = can(user.roles, 'cash.validate', account.entityId);

  const history = await balanceHistory(user, id, 30);
  const [siblings, categories, withdrawals, sessions] = await Promise.all([
    listAccounts(user, { entityIds: [account.entityId] }),
    listCategories(user, account.entityId),
    listWithdrawals(user, 'IN_TRANSIT'),
    account.type === 'CASH' ? listCashSessions(user, id) : Promise.resolve([]),
  ]);
  const inTransit = withdrawals.filter((w) => w.bankAccountId === id || w.cashAccountId === id);
  const pendingSessions = sessions.filter((s) => s.status === 'PENDING_VALIDATION');
  const nameOf = new Map(siblings.map((a) => [a.id, a.name]));

  return (
    <div className="grid gap-6">
      <Card>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">{account.name}</h1>
            <p className="text-sm text-muted">
              {account.type === 'CASH' ? 'Caisse' : `${account.bankName ?? 'Banque'} ${account.accountNumberMasked ?? ''}`} · {account.currency}
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted">Solde (dérivé du grand livre)</div>
            <Money value={account.balance} currency={account.currency} className="text-2xl font-semibold" />
          </div>
        </div>
      </Card>

      <ChartCard
        title="Évolution du solde" subtitle={`30 derniers jours · ${account.currency} · dérivé du grand livre`}
        table={{ columns: ['Jour', 'Solde'], rows: history.points.filter((_, i) => i % 3 === 0).map((p) => [fmtDay(p.date), p.balance.toFixed(2)]) }}
      >
        <LineChart label={`Solde de ${account.name} sur 30 jours`} currency={account.currency} categories={history.points.map((p) => String(new Date(p.date.getTime() + 2 * 3600_000).getUTCDate()))} series={[{ name: 'Solde', values: history.points.map((p) => p.balance) }]} tickEvery={5} />
      </ChartCard>

      {inTransit.length > 0 && (
        <Card>
          <CardTitle>Retraits en transit</CardTitle>
          <ul className="divide-y divide-border text-sm">
            {inTransit.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <div className="font-mono text-xs">{w.reference}</div>
                  <div>{nameOf.get(w.bankAccountId)} → {nameOf.get(w.cashAccountId)}</div>
                  <Money value={w.amount} currency={w.currency} className="font-semibold" />
                </div>
                <PendingAction kind="withdrawal" id={w.id} canConfirm={isCashier && w.cashAccountId === id} canCancel={canRecord} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {pendingSessions.length > 0 && (
        <Card>
          <CardTitle>Écarts de caisse en attente de validation</CardTitle>
          <ul className="divide-y divide-border text-sm">
            {pendingSessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <div>{formatDate(s.date)} · théorique <Money value={s.theoreticalBalance} currency={account.currency} /> · compté <Money value={s.countedBalance} currency={account.currency} /></div>
                  <div>Écart : <Money value={s.difference} currency={account.currency} className="font-semibold" /></div>
                  <div className="text-muted">« {s.justification} »</div>
                </div>
                <PendingAction kind="cashSession" id={s.id} canConfirm={canValidate} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <AccountActions
        entityId={account.entityId}
        account={{ id: account.id, name: account.name, type: account.type, currency: account.currency }}
        others={siblings.filter((a) => a.id !== id && a.isActive).map((a) => ({ id: a.id, name: a.name, type: a.type, currency: a.currency }))}
        categories={categories.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
        canRecord={canRecord}
        canClose={canClose && account.type === 'CASH'}
      />

      <Card>
        <CardTitle>Mouvements</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr><th className="pb-2">Date</th><th>Référence</th><th>Libellé</th><th className="text-right">Montant</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ledger.data.length === 0 && <tr><td colSpan={5} className="py-6 text-muted">Aucun mouvement.</td></tr>}
              {ledger.data.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-3">{formatDate(r.date)}</td>
                  <td className="pr-3 font-mono text-xs">{r.reference}</td>
                  <td className="pr-3">
                    {r.description} {r.status === 'REVERSED' && <StatusBadge tone="warning">Contre-passée</StatusBadge>}
                  </td>
                  <td className="text-right"><Money value={r.amount} currency={account.currency} /></td>
                  <td className="pl-3 text-right whitespace-nowrap">
                    {(evidence.get(idByRef.get(r.reference) ?? '') ?? 0) > 0 && (
                      <span className="mr-3 inline-flex items-center gap-1 text-xs text-primary" title="Justificatif joint">
                        <Paperclip className="size-3.5" aria-hidden /> {evidence.get(idByRef.get(r.reference)!)}
                        <span className="sr-only"> justificatif(s)</span>
                      </span>
                    )}
                    {idByRef.get(r.reference) && <Link href={`/operations/${idByRef.get(r.reference)}`} className="mr-3 text-xs text-primary hover:underline">Document</Link>}
                    {canReverse && r.status === 'POSTED' && r.kind !== 'REVERSAL' && idByRef.get(r.reference) && (
                      <ReverseButton txId={idByRef.get(r.reference)!} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
