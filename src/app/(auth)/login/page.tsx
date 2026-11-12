'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [needTotp, setNeedTotp] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      await api('/auth/login', {
        method: 'POST',
        body: {
          email: form.get('email'),
          password: form.get('password'),
          totp: needTotp ? form.get('totp') : undefined,
        },
      });
      router.replace('/');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TOTP_REQUIRED') setNeedTotp(true);
      else setError(err instanceof Error ? err.message : 'Connexion impossible');
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-2xl bg-card p-8 shadow-xl">
        <h1 className="text-xl font-bold">
          SEC <span className="font-light text-primary">Finance Control</span>
        </h1>
        <p className="mb-6 mt-1 text-sm text-muted">Connectez-vous pour continuer</p>

        <Field label="E-mail">
          <input name="email" type="email" required autoComplete="username" className={inputClass} />
        </Field>
        <Field label="Mot de passe">
          <input name="password" type="password" required autoComplete="current-password" className={inputClass} />
        </Field>
        {needTotp && (
          <Field label="Code de vérification" hint="Code à 6 chiffres de votre application d'authentification">
            <input
              name="totp" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoFocus
              autoComplete="one-time-code" className={inputClass}
            />
          </Field>
        )}

        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Connexion…' : 'Se connecter'}
        </Button>
      </form>
    </main>
  );
}
