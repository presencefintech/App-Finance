import { redirect } from 'next/navigation';
import { Forbidden } from '@/components/forbidden';
import { canAccessPath } from '@/lib/navigation';
import { Card } from '@/components/ui/card';
import { ReferentialsAdmin } from '@/components/referentials-admin';
import { SettingsNav } from '@/components/settings-nav';
import { getCurrentUser } from '@/server/auth';
import { listEntities } from '@/server/modules/entities/service';

export default async function ReferentielsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath('/parametres', user.roles)) return <Forbidden />;
  if (!user.roles.some((r) => r.role === 'ADMIN')) return <Card>Cette page est réservée aux administrateurs.</Card>;
  const entities = await listEntities(user);
  return (
    <>
      <SettingsNav current="/parametres/referentiels" />
      <ReferentialsAdmin entities={entities.map((e) => ({ id: e.id, name: e.name }))} />
    </>
  );
}
