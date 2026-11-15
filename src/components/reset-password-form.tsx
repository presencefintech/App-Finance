'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';

export function ResetPasswordForm({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const next = String(data.get('newPassword'));
    if (next !== String(data.get('confirm'))) return setError('Les deux mots de passe ne correspondent pas');
    setPending(true);
    setError(null);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, newPassword: next } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Réinitialisation impossible');
    }
    setPending(false);
  }

  return (
    <div className="w-full max-w-sm rounded-2xl bg-card p-8 shadow-xl">
      <h1 className="text-lg font-semibold">Nouveau mot de passe</h1>
      {done ? (
        <>
          <p className="mb-6 mt-3 text-sm text-muted">Votre mot de passe a été modifié. Tous vos appareils ont été déconnectés.</p>
          <Link href="/login" className="text-sm font-medium text-primary hover:underline">Se connecter</Link>
        </>
      ) : !token ? (
        <p className="mt-3 text-sm text-muted">
          Lien invalide. <Link href="/mot-de-passe-oublie" className="text-primary hover:underline">Refaire une demande</Link>
        </p>
      ) : (
        <form onSubmit={onSubmit}>
          <p className="mb-6 mt-1 text-sm text-muted">Choisissez un nouveau mot de passe (12 caractères minimum).</p>
          <Field label="Nouveau mot de passe">
            <input name="newPassword" type="password" required minLength={12} autoFocus autoComplete="new-password" className={inputClass} />
          </Field>
          <Field label="Confirmer le mot de passe">
            <input name="confirm" type="password" required minLength={12} autoComplete="new-password" className={inputClass} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={pending} className="w-full">{pending ? 'Enregistrement…' : 'Enregistrer'}</Button>
        </form>
      )}
    </div>
  );
}
