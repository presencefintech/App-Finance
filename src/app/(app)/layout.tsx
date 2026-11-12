import { redirect } from 'next/navigation';
import { MobileNav, Sidebar } from '@/components/sidebar';
import { visibleNav } from '@/lib/navigation';
import { Topbar } from '@/components/topbar';
import { TotpSetup } from '@/components/totp-setup';
import { getCurrentUser } from '@/server/auth';
import { getSelectedEntities } from '@/server/entity-selection';
import { countUnread } from '@/server/modules/notifications/service';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const [{ selection }, unread] = await Promise.all([getSelectedEntities(user), countUnread(user)]);

  const items = visibleNav(user.roles).map(({ href, label, icon }) => ({ href, label, icon }));

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <MobileNav items={items} />
      <Sidebar items={items} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar userName={user.fullName} selection={selection} unread={unread} />
        <main className="flex-1 p-6">
          {/* Tant que la 2FA obligatoire n'est pas activée, seul l'enrôlement est affiché. */}
          {user.needsTotpSetup ? <TotpSetup required /> : children}
        </main>
      </div>
    </div>
  );
}
