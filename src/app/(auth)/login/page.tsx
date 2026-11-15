'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [needTotp, setNeedTotp] = useState(false);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-xl font-bold text-white">F</div>
          <h1 className="text-2xl font-bold text-white">
            Finance <span className="font-light text-primary">Control</span>
          </h1>
          <p className="mt-1 text-sm text-white/60">Trésorerie, contrôle bancaire et reporting</p>
        </div>
        <form onSubmit={onSubmit} className="rounded-2xl bg-card p-8 shadow-xl">
          <h2 className="text-lg font-semibold">Connexion</h2>
          <p className="mb-6 mt-1 text-sm text-muted">Entrez vos identifiants pour accéder à votre espace.</p>

          <Field label="E-mail">
            <input name="email" type="email" required autoFocus autoComplete="username" placeholder="nom@organisation.com" className={inputClass} />
          </Field>
          <Field label="Mot de passe">
            <div className="relative">
              <input
                name="password" type={showPassword ? 'text' : 'password'} required autoComplete="current-password"
                className={`${inputClass} pr-24`}
              />
              <button
                type="button" onClick={() => setShowPassword((v) => !v)} aria-pressed={showPassword}
                className="absolute inset-y-0 right-3 text-xs font-medium text-primary hover:underline"
              >
                {showPassword ? 'Masquer' : 'Afficher'}
              </button>
            </div>
          </Field>
          {needTotp && (
            <Field label="Code de vérification" hint="Code à 6 chiffres de votre application d'authentification">
              <input
                name="totp" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoFocus
                autoComplete="one-time-code" className={inputClass}
              />
            </Field>
          )}

          <p className="mb-4 -mt-2 text-right text-xs">
            <Link href="/mot-de-passe-oublie" className="text-primary hover:underline">Mot de passe oublié ?</Link>
          </p>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Connexion…' : 'Se connecter'}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-white/50">Accès réservé aux utilisateurs autorisés. Vos actions sont journalisées.</p>
      </div>
    </main>
  );
}
