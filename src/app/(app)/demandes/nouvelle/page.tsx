import { redirect } from 'next/navigation';
import { Forbidden } from '@/components/forbidden';
import { canAccessPath } from '@/lib/navigation';
import { Card } from '@/components/ui/card';
import { FundRequestForm } from '@/components/fund-request-form';
import { can } from '@/lib/permissions';
import { getCurrentUser } from '@/server/auth';
import { listEntities } from '@/server/modules/entities/service';

export default async function NouvelleDemande() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath('/demandes', user.roles)) return <Forbidden />;
  const entities = (await listEntities(user)).filter((e) => can(user.roles, 'fundRequest.create', e.id));
  if (entities.length === 0) return <Card>Vous n’avez pas le droit de créer une demande de fonds.</Card>;
  return <FundRequestForm entities={entities} />;
}
