import { Card, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { SessionsList } from '@/components/sessions-list';
import { TotpSetup } from '@/components/totp-setup';
import { getCurrentUser } from '@/server/auth';
import { redirect } from 'next/navigation';

export default async function ProfilPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <Card>
        <CardTitle>Mon profil</CardTitle>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Nom</dt>
          <dd>{user.fullName}</dd>
          <dt className="text-muted">E-mail</dt>
          <dd>{user.email}</dd>
          <dt className="text-muted">2FA</dt>
          <dd>
            {user.totpEnabled ? <StatusBadge tone="success">Activée</StatusBadge> : <StatusBadge tone="warning">Non activée</StatusBadge>}
          </dd>
        </dl>
      </Card>
      {!user.totpEnabled && <TotpSetup required={false} />}
      <Card>
        <CardTitle>Sessions actives</CardTitle>
        <SessionsList />
      </Card>
    </div>
  );
}
