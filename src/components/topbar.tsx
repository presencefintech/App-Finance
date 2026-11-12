import Link from 'next/link';
import { Bell } from 'lucide-react';
import { EntitySwitch } from './entity-switch';
import { LogoutButton } from './logout-button';

export function Topbar({ userName, selection, unread, entities, organizationName }: { userName: string; selection: string; unread: number; entities: { code: string; name: string }[]; organizationName: string | null }) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-4">
        {organizationName && <span className="hidden text-sm font-semibold sm:block">{organizationName}</span>}
        <EntitySwitch current={selection} entities={entities} />
      </div>
      <div className="flex items-center gap-4 text-sm text-muted">
        <Link href="/notifications" className="relative" title="Notifications">
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute -right-2 -top-2 flex size-4 items-center justify-center rounded-full bg-danger text-[10px] font-semibold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Link>
        <span>{userName}</span>
        <LogoutButton />
      </div>
    </header>
  );
}
