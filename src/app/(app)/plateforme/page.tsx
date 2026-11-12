import { redirect } from 'next/navigation';
import { Forbidden } from '@/components/forbidden';
import { PlatformAdmin } from '@/components/platform-admin';
import { canAccessPath } from '@/lib/navigation';
import { getCurrentUser } from '@/server/auth';
import { listOrganizations } from '@/server/modules/platform/service';

export default async function PlateformePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath('/plateforme', user.roles, user.isPlatformAdmin)) return <Forbidden />;
  const orgs = await listOrganizations(user);
  return <PlatformAdmin organizations={JSON.parse(JSON.stringify(orgs))} />;
}
