import { redirect } from 'next/navigation';
import { MANAGER_ROLES } from '@/lib/permissions';
import { Forbidden } from '@/components/forbidden';
import { canAccessPath } from '@/lib/navigation';
import { Card } from '@/components/ui/card';
import { LimitsAdmin } from '@/components/limits-admin';
import { SettingsNav } from '@/components/settings-nav';
import { getCurrentUser } from '@/server/auth';
import { listEntities } from '@/server/modules/entities/service';

export default async function PlafondsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath('/parametres', user.roles)) return <Forbidden />;
  if (!user.roles.some((r) => MANAGER_ROLES.includes(r.role))) return <Card>Cette page est réservée aux administrateurs et directeurs.</Card>;
  const entities = await listEntities(user);
  return (
    <>
      <SettingsNav current="/parametres/plafonds" />
      <LimitsAdmin entities={entities.map((e) => ({ id: e.id, name: e.name }))} />
    </>
  );
}
