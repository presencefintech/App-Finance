import { Bell, UserRound } from 'lucide-react';

export function Topbar() {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
      <div className="inline-flex rounded-lg border border-border p-0.5 text-sm">
        {['SEC', 'École', 'Consolidé'].map((label, i) => (
          <button
            key={label}
            className={i === 2 ? 'rounded-md bg-primary px-3 py-1 font-medium text-white' : 'rounded-md px-3 py-1 text-muted'}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-4 text-muted">
        <Bell className="size-5" />
        <UserRound className="size-5" />
      </div>
    </header>
  );
}
