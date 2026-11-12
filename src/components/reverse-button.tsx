'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, ErrorText, inputClass } from '@/components/ui/form';
import { useStepUp } from '@/components/providers';

/** Contre-passation : motif obligatoire + confirmation 2FA (step-up). Aucune suppression possible. */
export function ReverseButton({ txId }: { txId: string }) {
  const router = useRouter();
  const withStepUp = useStepUp();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const reverse = useMutation({
    mutationFn: () => withStepUp(() => api(`/transactions/${txId}/reverse`, { method: 'POST', body: { reason } })),
    onSuccess: () => { setOpen(false); setReason(''); router.refresh(); },
  });

  if (!open) return <Button variant="ghost" onClick={() => setOpen(true)}>Contre-passer</Button>;
  return (
    <div className="flex flex-col items-end gap-2">
      <input className={inputClass} placeholder="Motif (obligatoire)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <ErrorText>{reverse.error?.message}</ErrorText>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
        <Button variant="danger" disabled={reverse.isPending || reason.trim().length < 5} onClick={() => reverse.mutate()}>
          Confirmer
        </Button>
      </div>
    </div>
  );
}
