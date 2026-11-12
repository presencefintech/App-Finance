export const ROLE_LABELS = {
  ADMIN: 'Administrateur',
  CONTROLLER: 'Contrôleuse financière',
  DIRECTOR: 'Direction',
  CASHIER: 'Caissier',
  REQUESTER: 'Demandeur',
  VIEWER: 'Lecture seule',
} as const;

export const ROLE_OPTIONS = Object.keys(ROLE_LABELS) as (keyof typeof ROLE_LABELS)[];

export const FUND_REQUEST_STATUS = {
  DRAFT: { label: 'Brouillon', tone: 'neutral' },
  SUBMITTED: { label: 'Soumise', tone: 'warning' },
  UNDER_REVIEW: { label: 'En examen', tone: 'warning' },
  ESCALATED: { label: 'Transmise au chef', tone: 'warning' },
  APPROVED: { label: 'Approuvée', tone: 'success' },
  REJECTED: { label: 'Rejetée', tone: 'danger' },
  DISBURSED: { label: 'Décaissée', tone: 'success' },
  RECEIVED: { label: 'Reçue', tone: 'success' },
  JUSTIFIED: { label: 'Justifiée', tone: 'success' },
  CLOSED: { label: 'Clôturée', tone: 'neutral' },
  CANCELLED: { label: 'Annulée', tone: 'neutral' },
} as const;

export type FundRequestStatusKey = keyof typeof FUND_REQUEST_STATUS;
