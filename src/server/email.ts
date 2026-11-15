import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { after } from 'next/server';

/**
 * Envoi d'e-mails via Resend (API HTTP, aucune dépendance). Sans RESEND_API_KEY, l'envoi est désactivé :
 * l'application fonctionne normalement avec ses seules notifications internes.
 *
 * Variables : RESEND_API_KEY, EMAIL_FROM (ex. « Finance Control <noreply@votre-domaine.com> », domaine vérifié chez Resend).
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export const emailEnabled = (): boolean => Boolean(process.env.RESEND_API_KEY);

const outbox = new AsyncLocalStorage<Mail[]>();

async function deliver(mail: Mail): Promise<void> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? 'Finance Control <onboarding@resend.dev>',
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
      }),
    });
    // Jamais le contenu ni l'adresse dans les logs.
    if (!res.ok) console.error('Échec d’envoi e-mail', res.status);
  } catch (err) {
    console.error('Échec d’envoi e-mail', err instanceof Error ? err.message : 'erreur réseau');
  }
}

/** Envoie après la réponse HTTP quand c'est possible (n'allonge pas la requête, ne change pas le temps de réponse). */
function dispatch(mails: Mail[]): void {
  if (!emailEnabled() || mails.length === 0) return;
  const run = async () => { await Promise.all(mails.map(deliver)); };
  try {
    after(run);
  } catch {
    void run(); // hors requête (scripts, tests)
  }
}

/** Dans un Route Handler : mis en file, envoyé seulement si la requête réussit (jamais d'e-mail pour une transaction annulée). */
export function queueEmail(mail: Mail): void {
  if (!emailEnabled()) return;
  const store = outbox.getStore();
  if (store) store.push(mail);
  else dispatch([mail]);
}

/** Exécute `fn` ; les e-mails mis en file ne partent que si elle se termine sans erreur. */
export async function collectEmails<T>(fn: () => Promise<T>): Promise<T> {
  const mails: Mail[] = [];
  const result = await outbox.run(mails, fn);
  dispatch(mails);
  return result;
}

/** E-mail direct (hors transaction), ex. réinitialisation de mot de passe. */
export function sendEmail(mail: Mail): void {
  dispatch([mail]);
}
