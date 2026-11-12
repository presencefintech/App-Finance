import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardTitle } from '@/components/ui/card';
import { MarkReadButton } from '@/components/mark-read-button';
import { formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/server/auth';
import { listNotifications } from '@/server/modules/notifications/service';

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { data, unread } = await listNotifications(user);
  return (
    <Card className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <CardTitle>Notifications</CardTitle>
        {unread > 0 && <MarkReadButton />}
      </div>
      <ul className="divide-y divide-border text-sm">
        {data.length === 0 && <li className="py-6 text-muted">Aucune notification.</li>}
        {data.map((n) => (
          <li key={n.id} className="py-3">
            <div className="flex items-start gap-2">
              {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
              <div>
                {n.href ? <Link href={n.href} className="font-medium hover:text-primary">{n.title}</Link> : <span className="font-medium">{n.title}</span>}
                <div className="text-muted">{n.body}</div>
                <div className="text-xs text-muted">{formatDateTime(n.createdAt)}</div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
