import { redirect } from 'next/navigation';
import { Forbidden } from '@/components/forbidden';
import { PlatformAdmin } from '@/components/platform-admin';
import { canAccessPath } from '@/lib/navigation';
import { getCurrentUser } from '@/server/auth';
import { Card } from '@/components/ui/card';
import { listOrganizations, platformAdminAvailable } from '@/server/modules/platform/service';

export default async function PlateformePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath('/plateforme', user.roles, user.isPlatformAdmin)) return <Forbidden />;
  if (!platformAdminAvailable()) {
    return (
      <Card>
        <h1 className="text-base font-semibold">Gestion des organisations indisponible ici</h1>
        <p className="mt-1 text-sm text-muted">Ce déploiement n’a pas la connexion dédiée de la plateforme (PLATFORM_DATABASE_URL). Créez et suspendez les organisations depuis l’application où cette fonction est activée.</p>
      </Card>
    );
  }
  const orgs = await listOrganizations(user);
  return <PlatformAdmin organizations={JSON.parse(JSON.stringify(orgs))} />;
}
