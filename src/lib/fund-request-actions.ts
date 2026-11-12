import type { Role } from '@/generated/prisma/enums';

export type FundRequestAction =
  | 'submit' | 'cancel' | 'review' | 'approve' | 'reject' | 'escalate'
  | 'disburse' | 'confirm-receipt' | 'justify' | 'close';

/**
 * Actions proposées dans l'interface selon statut et rôles. Simple aide d'affichage :
 * le serveur (service des demandes) refait tous les contrôles.
 */
export function availableActions(input: {
  status: string; userId: string; requesterId: string; approvedById?: string | null; roles: Role[];
}): FundRequestAction[] {
  const { status, userId, requesterId, roles } = input;
  const isRequester = userId === requesterId;
  const isController = roles.includes('CONTROLLER');
  const isDirector = roles.includes('DIRECTOR');
  const isCashier = roles.includes('CASHIER');
  const out: FundRequestAction[] = [];

  if (isRequester) {
    if (status === 'DRAFT') out.push('submit', 'cancel');
    if (status === 'SUBMITTED') out.push('cancel');
    if (status === 'DISBURSED') out.push('confirm-receipt');
    if (status === 'RECEIVED') out.push('justify');
    return out; // le demandeur n'agit jamais sur sa propre demande en tant qu'approbateur
  }
  if (isController && status === 'SUBMITTED') out.push('review');
  if ((isController && status === 'UNDER_REVIEW') || (isDirector && ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'].includes(status))) {
    out.push('approve', 'reject');
  }
  if (isController && status === 'UNDER_REVIEW') out.push('escalate');
  if (isCashier && status === 'APPROVED') out.push('disburse');
  if (isController && status === 'JUSTIFIED') out.push('close');
  return out;
}
