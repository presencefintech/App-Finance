'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { FundRequestAction } from '@/lib/fund-request-actions';
import { formatMoney } from '@/lib/money';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';
import { useStepUp } from '@/components/providers';

const LABELS: Record<FundRequestAction, string> = {
  submit: 'Soumettre', cancel: 'Annuler la demande', review: 'Prendre en examen', approve: 'Approuver',
  reject: 'Rejeter', escalate: 'Transmettre au chef', disburse: 'Décaisser',
  'confirm-receipt': 'Confirmer la réception des fonds', justify: 'Envoyer les justificatifs', close: 'Clôturer',
};
const NEEDS_COMMENT = new Set<FundRequestAction>(['reject']);
const OPTIONAL_COMMENT = new Set<FundRequestAction>(['approve', 'escalate', 'close', 'justify']);

interface AccountRow { id: string; name: string; currency: 'USD' | 'CDF'; balance: string; entityId: string; isActive: boolean }
interface EntityRow { id: string; name: string }

export function FundRequestActions({
  id, actions, entityId, amount, currency, reference,
}: {
  id: string; actions: FundRequestAction[]; entityId: string; amount: string; currency: 'USD' | 'CDF'; reference: string;
}) {
  const router = useRouter();
  const withStepUp = useStepUp();
  const [active, setActive] = useState<FundRequestAction | null>(null);
  const [comment, setComment] = useState('');
  const [accountId, setAccountId] = useState('');

  const accounts = useQuery({
    queryKey: ['accounts', 'all', currency],
    queryFn: () => api<{ data: AccountRow[] }>('/accounts'),
    enabled: active === 'disburse',
  });
  const entities = useQuery({ queryKey: ['entities'], queryFn: () => api<{ data: EntityRow[] }>('/entities'), enabled: active === 'disburse' });
  const entityName = (id: string) => entities.data?.data.find((e) => e.id === id)?.name ?? '';
  // Comptes de la même devise, y compris ceux de l'autre entité (⇒ avance inter-entités).
  const usable = accounts.data?.data.filter((a) => a.currency === currency && a.isActive) ?? [];
  const chosen = usable.find((a) => a.id === accountId);
  const isAdvance = Boolean(chosen && chosen.entityId !== entityId);

  const run = useMutation({
    mutationFn: (action: FundRequestAction) =>
      withStepUp(() =>
        api(`/fund-requests/${id}/${action}`, {
          method: 'POST',
          body: action === 'disburse' ? { accountId, confirmAdvance: isAdvance || undefined } : { comment: comment || undefined },
        }),
      ),
    onSuccess: () => { setActive(null); setComment(''); router.refresh(); },
  });

  if (actions.length === 0) return null;

  return (
    <div className="mt-5 border-t border-border pt-4">
      {!active ? (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button key={a} variant={a === 'reject' || a === 'cancel' ? 'ghost' : 'primary'} onClick={() => { run.reset(); setActive(a); }}>
              {LABELS[a]}
            </Button>
          ))}
        </div>
      ) : (
        <div className="max-w-md">
          <h3 className="mb-2 text-sm font-semibold">{LABELS[active]}</h3>
          {active === 'disburse' && (
            <>
              <Field label="Compte à débiter">
                <select className={inputClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">Choisir…</option>
                  {usable.map((a) => <option key={a.id} value={a.id}>{entityName(a.entityId)} · {a.name} — solde {formatMoney(a.balance, a.currency)}</option>)}
                </select>
              </Field>
              {chosen && !isAdvance && (
                <p className="mb-3 rounded-lg bg-warning/15 p-3 text-sm">
                  Vous allez décaisser <strong>{formatMoney(amount, currency)}</strong> depuis <strong>{chosen.name}</strong> pour la
                  demande {reference}. Cette écriture ne pourra être corrigée que par contre-passation.
                </p>
              )}
              {chosen && isAdvance && (
                <p className="mb-3 rounded-lg bg-danger/10 p-3 text-sm">
                  <strong>Avance inter-entités.</strong> La caisse « {chosen.name} » de <strong>{entityName(chosen.entityId)}</strong> va avancer{' '}
                  <strong>{formatMoney(amount, currency)}</strong> à <strong>{entityName(entityId)}</strong> (demande {reference}). Ce sera une
                  créance pour {entityName(chosen.entityId)} et une dette pour {entityName(entityId)} — ni une recette ni une dépense
                  pour {entityName(chosen.entityId)}.
                </p>
              )}
            </>
          )}
          {(NEEDS_COMMENT.has(active) || OPTIONAL_COMMENT.has(active)) && (
            <Field label={NEEDS_COMMENT.has(active) ? 'Commentaire (obligatoire)' : 'Commentaire (optionnel)'}>
              <textarea rows={3} className={inputClass} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
          )}
          <ErrorText>{run.error?.message}</ErrorText>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setActive(null)}>Retour</Button>
            <Button
              disabled={run.isPending || (active === 'disburse' && !accountId) || (NEEDS_COMMENT.has(active) && comment.trim().length < 3)}
              onClick={() => run.mutate(active)}
            >
              Confirmer
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
