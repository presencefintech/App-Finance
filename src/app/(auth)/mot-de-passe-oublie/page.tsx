'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: { email: new FormData(e.currentTarget).get('email') } });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demande impossible');
    }
    setPending(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm rounded-2xl bg-card p-8 shadow-xl">
        <h1 className="text-lg font-semibold">Mot de passe oublié</h1>
        {sent ? (
          <>
            <p className="mb-6 mt-3 text-sm text-muted">
              Si un compte correspond à cette adresse, un e-mail contenant un lien de réinitialisation (valable 1 heure) vient d’être envoyé.
              Pensez à vérifier vos courriers indésirables.
            </p>
            <Link href="/login" className="text-sm font-medium text-primary hover:underline">Retour à la connexion</Link>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <p className="mb-6 mt-1 text-sm text-muted">Entrez votre adresse e-mail : nous vous enverrons un lien pour choisir un nouveau mot de passe.</p>
            <Field label="E-mail">
              <input name="email" type="email" required autoFocus autoComplete="username" className={inputClass} />
            </Field>
            <ErrorText>{error}</ErrorText>
            <Button type="submit" disabled={pending} className="w-full">{pending ? 'Envoi…' : 'Envoyer le lien'}</Button>
            <p className="mt-4 text-center text-sm"><Link href="/login" className="text-primary hover:underline">Retour à la connexion</Link></p>
          </form>
        )}
      </div>
    </main>
  );
}
