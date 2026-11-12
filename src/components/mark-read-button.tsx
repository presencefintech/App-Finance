'use client';

import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/form';

export function MarkReadButton() {
  const router = useRouter();
  const mark = useMutation({
    mutationFn: () => api('/notifications', { method: 'POST' }),
    onSuccess: () => router.refresh(),
  });
  return <Button variant="ghost" onClick={() => mark.mutate()} disabled={mark.isPending}>Tout marquer comme lu</Button>;
}
