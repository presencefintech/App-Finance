'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  async function onClick() {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }
  return (
    <button onClick={onClick} title="Se déconnecter" className="text-muted hover:text-foreground">
      <LogOut className="size-5" />
    </button>
  );
}
