'use client';

import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

const OPTIONS = [
  { value: 'SEC', label: 'SEC' },
  { value: 'ECOLE', label: 'École' },
  { value: 'ALL', label: 'Consolidé' },
] as const;

export function EntitySwitch({ current }: { current: string }) {
  const router = useRouter();
  async function select(selection: string) {
    await api('/preferences/entity', { method: 'POST', body: { selection } });
    router.refresh();
  }
  return (
    <div className="inline-flex rounded-lg border border-border p-0.5 text-sm">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          onClick={() => select(o.value)}
          className={cn('rounded-md px-3 py-1', current === o.value ? 'bg-primary font-medium text-white' : 'text-muted')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
