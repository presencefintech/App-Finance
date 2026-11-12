import { redirect } from 'next/navigation';
import { MobileNav, Sidebar } from '@/components/sidebar';
import { visibleNav } from '@/lib/navigation';
import { Topbar } from '@/components/topbar';
import { TotpSetup } from '@/components/totp-setup';
import { getCurrentUser } from '@/server/auth';
import { getSelectedEntities } from '@/server/entity-selection';
import { getOrganizationName } from '@/server/modules/entities/service';
import { countUnread } from '@/server/modules/notifications/service';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // Un administrateur de plateforme n'a ni organisation ni entité : pas de données métier à charger.
  const hasOrg = Boolean(user.organizationId);
  const [{ selection, available }, unread, organizationName] = hasOrg
    ? await Promise.all([getSelectedEntities(user), countUnread(user), getOrganizationName()])
    : [{ selection: 'ALL', available: [] as { id: string; code: string; name: string }[] }, 0, null];

  const items = visibleNav(user.roles, user.isPlatformAdmin).map(({ href, label, icon }) => ({ href, label, icon }));

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <MobileNav items={items} />
      <Sidebar items={items} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar userName={user.fullName} selection={selection} unread={unread} entities={available.map((e) => ({ code: e.code, name: e.name }))} organizationName={organizationName ?? (user.isPlatformAdmin ? 'Plateforme' : null)} />
        <main className="flex-1 p-6">
          {/* Tant que la 2FA obligatoire n'est pas activée, seul l'enrôlement est affiché. */}
          {user.needsTotpSetup ? <TotpSetup required /> : children}
        </main>
      </div>
    </div>
  );
}
