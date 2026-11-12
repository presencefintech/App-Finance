'use client';

import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

/** Sélecteur des entités DE L'ORGANISATION ; « Consolidé » n'apparaît que s'il y a plusieurs entités. */
export function EntitySwitch({ current, entities }: { current: string; entities: { code: string; name: string }[] }) {
  const router = useRouter();
  if (entities.length === 0) return <span />;
  const options = [...entities.map((e) => ({ value: e.code, label: e.name })), ...(entities.length > 1 ? [{ value: 'ALL', label: 'Consolidé' }] : [])];
  async function select(selection: string) {
    await api('/preferences/entity', { method: 'POST', body: { selection } });
    router.refresh();
  }
  return (
    <div className="inline-flex rounded-lg border border-border p-0.5 text-sm">
      {options.map((o) => (
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
