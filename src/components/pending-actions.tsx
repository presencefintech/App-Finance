'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, ErrorText, inputClass } from '@/components/ui/form';

/** Confirme ou annule un retrait en transit ; valide un écart de caisse. */
export function PendingAction({
  kind, id, canConfirm, canCancel,
}: {
  kind: 'withdrawal' | 'cashSession'; id: string; canConfirm: boolean; canCancel?: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const done = { onSuccess: () => router.refresh() };
  const confirm = useMutation({
    mutationFn: () => api(kind === 'withdrawal' ? `/bank/withdrawals/${id}/confirm-receipt` : `/cash/closings/${id}/validate`, { method: 'POST' }),
    ...done,
  });
  const cancel = useMutation({
    mutationFn: () => api(`/bank/withdrawals/${id}/cancel`, { method: 'POST', body: { reason } }),
    ...done,
  });

  return (
    <div className="flex flex-col items-end gap-2">
      <ErrorText>{confirm.error?.message ?? cancel.error?.message}</ErrorText>
      {cancelling ? (
        <div className="flex gap-2">
          <input className={inputClass} placeholder="Motif" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="danger" disabled={reason.trim().length < 3 || cancel.isPending} onClick={() => cancel.mutate()}>Annuler le retrait</Button>
          <Button variant="ghost" onClick={() => setCancelling(false)}>Retour</Button>
        </div>
      ) : (
        <div className="flex gap-2">
          {canConfirm && (
            <Button disabled={confirm.isPending} onClick={() => confirm.mutate()}>
              {kind === 'withdrawal' ? 'Confirmer la réception' : 'Valider l’écart'}
            </Button>
          )}
          {canCancel && kind === 'withdrawal' && <Button variant="ghost" onClick={() => setCancelling(true)}>Annuler</Button>}
        </div>
      )}
    </div>
  );
}
