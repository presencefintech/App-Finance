'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';

type WithStepUp = <T>(fn: () => Promise<T>) => Promise<T>;
const StepUpContext = createContext<WithStepUp>((fn) => fn());

/** Exécute `fn` ; si l'API répond STEP_UP_REQUIRED, demande le code 2FA puis rejoue `fn`. */
export const useStepUp = () => useContext(StepUpContext);

function StepUpProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const waiter = useRef<{ resolve: () => void; reject: (e: Error) => void } | null>(null);

  const askCode = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        waiter.current = { resolve, reject };
        setCode('');
        setError(null);
        setOpen(true);
      }),
    [],
  );

  const withStepUp: WithStepUp = useCallback(
    async (fn) => {
      try {
        return await fn();
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== 'STEP_UP_REQUIRED') throw e;
        await askCode();
        return fn();
      }
    },
    [askCode],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api('/auth/step-up', { method: 'POST', body: { code } });
      setOpen(false);
      waiter.current?.resolve();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code incorrect');
    } finally {
      setPending(false);
    }
  }

  function cancel() {
    setOpen(false);
    waiter.current?.reject(new Error('Confirmation annulée'));
  }

  return (
    <StepUpContext.Provider value={withStepUp}>
      {children}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl">
            <h2 className="mb-1 text-base font-semibold">Confirmation requise</h2>
            <p className="mb-4 text-sm text-muted">
              Cette opération est sensible. Saisissez le code de votre application d&apos;authentification.
            </p>
            <Field label="Code à 6 chiffres">
              <input
                autoFocus value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric"
                maxLength={6} autoComplete="one-time-code" className={inputClass}
              />
            </Field>
            <ErrorText>{error}</ErrorText>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={cancel}>Annuler</Button>
              <Button type="submit" disabled={pending || code.length !== 6}>Confirmer</Button>
            </div>
          </form>
        </div>
      )}
    </StepUpContext.Provider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  // Aucune donnée financière mise en cache : staleTime 0.
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 0, retry: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <StepUpProvider>{children}</StepUpProvider>
    </QueryClientProvider>
  );
}
