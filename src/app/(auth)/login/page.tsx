'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';

const FEATURES = [
  { title: 'Soldes toujours justes', text: 'Calculés depuis le grand livre : aucune saisie à la main, aucune suppression.' },
  { title: 'Circuit d’approbation', text: 'Demande, validation, décaissement : chacun à sa place, tout est tracé.' },
  { title: 'Multi-devises USD / CDF', text: 'Taux, dates et sources enregistrés pour chaque conversion.' },
  { title: 'Organisations isolées', text: 'Vos données restent cloisonnées, au niveau même de la base.' },
];

function BrandMark({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center rounded-2xl bg-gradient-to-br from-[#12c38a] to-[#0a7f58] font-bold text-white shadow-lg shadow-emerald-900/30 ${className}`}>F</div>
  );
}

/** Mini graphique décoratif : barres de recettes/dépenses et courbe de solde. */
function Showcase() {
  const bars = [38, 56, 44, 72, 52, 84, 66];
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-5 backdrop-blur" aria-hidden="true">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-white/50">Trésorerie</p>
          <p className="mt-1 text-2xl font-semibold text-white">24 580,00 <span className="text-sm font-normal text-white/60">USD</span></p>
        </div>
        <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-medium text-emerald-300">+12,4 %</span>
      </div>
      <svg viewBox="0 0 280 90" className="h-24 w-full">
        {bars.map((h, i) => (
          <rect key={i} x={10 + i * 38} y={90 - h} width="22" height={h} rx="5" fill={i % 2 ? '#eb6834' : '#12c38a'} opacity={i % 2 ? 0.55 : 0.9} />
        ))}
        <polyline fill="none" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          points="21,60 59,44 97,52 135,28 173,40 211,16 249,24" />
      </svg>
    </div>
  );
}

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
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Panneau de marque (écrans larges) */}
      <section className="relative hidden overflow-hidden bg-[#0f1c1f] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-emerald-500/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-20 h-[28rem] w-[28rem] rounded-full bg-teal-400/15 blur-3xl" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:22px_22px]" />

        <div className="relative flex items-center gap-3">
          <BrandMark className="h-11 w-11 text-lg" />
          <span className="text-xl font-bold">Finance <span className="font-light text-emerald-300">Control</span></span>
        </div>

        <div className="relative max-w-lg">
          <h2 className="text-4xl font-bold leading-tight">
            Le contrôle de votre trésorerie, <span className="text-emerald-300">en toute confiance.</span>
          </h2>
          <p className="mt-4 text-white/65">Caisses, banques, demandes de fonds, rapprochement et rapports : une seule plateforme, des chiffres que l’on peut vérifier.</p>
          <div className="mt-8"><Showcase /></div>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-3">
                <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-300">
                  <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10.5l4 4 8-9" /></svg>
                </span>
                <span><span className="block text-sm font-semibold">{f.title}</span><span className="block text-xs leading-relaxed text-white/55">{f.text}</span></span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/40">Accès réservé aux utilisateurs autorisés. Toutes les actions sont journalisées.</p>
      </section>

      {/* Formulaire */}
      <section className="relative flex items-center justify-center overflow-hidden bg-gradient-to-b from-[#0f1c1f] to-[#17262a] p-4 lg:bg-none lg:bg-background lg:p-12">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-emerald-500/20 blur-3xl lg:hidden" />
        <div className="relative w-full max-w-sm">
          <div className="mb-6 text-center lg:hidden">
            <BrandMark className="mx-auto mb-3 h-12 w-12 text-xl" />
            <h1 className="text-2xl font-bold text-white">Finance <span className="font-light text-emerald-300">Control</span></h1>
            <p className="mt-1 text-sm text-white/60">Trésorerie, contrôle bancaire et reporting</p>
          </div>

          <form onSubmit={onSubmit} className="rounded-2xl border border-border bg-card p-8 shadow-2xl shadow-emerald-950/10">
            <div className="mb-1 h-1 w-10 rounded-full bg-gradient-to-r from-[#12c38a] to-[#0a7f58]" />
            <h2 className="mt-3 text-2xl font-bold">Bon retour 👋</h2>
            <p className="mb-6 mt-1 text-sm text-muted">Connectez-vous pour accéder à votre espace.</p>

            <Field label="E-mail">
              <input name="email" type="email" required autoFocus autoComplete="username" placeholder="nom@organisation.com" className={`${inputClass} py-2.5`} />
            </Field>
            <Field label="Mot de passe">
              <div className="relative">
                <input
                  name="password" type={showPassword ? 'text' : 'password'} required autoComplete="current-password"
                  className={`${inputClass} py-2.5 pr-24`}
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
                  autoComplete="one-time-code" className={`${inputClass} py-2.5 tracking-[0.4em]`}
                />
              </Field>
            )}
            <p className="mb-4 -mt-2 text-right text-xs">
              <Link href="/mot-de-passe-oublie" className="text-primary hover:underline">Mot de passe oublié ?</Link>
            </p>

            <ErrorText>{error}</ErrorText>
            <Button type="submit" disabled={pending} className="w-full bg-gradient-to-r from-[#12c38a] to-[#0a9468] py-2.5 text-base shadow-md shadow-emerald-700/25">
              {pending ? 'Connexion…' : 'Se connecter'}
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-white/50 lg:hidden">Accès réservé aux utilisateurs autorisés. Vos actions sont journalisées.</p>
        </div>
      </section>
    </main>
  );
}
