import { notFound, redirect } from 'next/navigation';
import { Forbidden } from '@/components/forbidden';
import { canAccessPath } from '@/lib/navigation';
import { StatementBoard } from '@/components/statement-board';
import { getCurrentUser } from '@/server/auth';
import { AppError } from '@/server/errors';
import { listCategories } from '@/server/modules/referentials/service';
import { getStatement } from '@/server/modules/reconciliation/service';

export default async function RapprochementDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath('/rapprochements', user.roles)) return <Forbidden />;
  const { id } = await params;
  let statement;
  try {
    statement = await getStatement(user, id);
  } catch (e) {
    if (e instanceof AppError && (e.httpStatus === 404 || e.httpStatus === 403)) notFound();
    throw e;
  }
  const categories = (await listCategories(user, statement.entityId)).filter((c) => c.kind === 'INCOME' && c.isActive);
  return (
    <StatementBoard
      statement={JSON.parse(JSON.stringify(statement))}
      incomeCategories={categories.map((c) => ({ id: c.id, name: c.name }))}
      currentUserId={user.id}
    />
  );
}
