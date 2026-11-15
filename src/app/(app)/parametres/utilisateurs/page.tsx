import { redirect } from 'next/navigation';
import { MANAGER_ROLES } from '@/lib/permissions';
import { Forbidden } from '@/components/forbidden';
import { canAccessPath } from '@/lib/navigation';
import { Card } from '@/components/ui/card';
import { SettingsNav } from '@/components/settings-nav';
import { UsersAdmin } from '@/components/users-admin';
import { getCurrentUser } from '@/server/auth';

export default async function UtilisateursPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath('/parametres', user.roles)) return <Forbidden />;
  if (!user.roles.some((r) => MANAGER_ROLES.includes(r.role))) {
    return <Card>Cette page est réservée aux administrateurs et directeurs.</Card>;
  }
  return (
    <>
      <SettingsNav current="/parametres/utilisateurs" />
      <UsersAdmin currentUserId={user.id} />
    </>
  );
}
