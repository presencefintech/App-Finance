'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui/card';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';

interface SetupData {
  secret: string;
  qrDataUrl: string;
}

export function TotpSetup({ required }: { required: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<SetupData | null>(null);
  const [code, setCode] = useState('');

  const start = useMutation({
    mutationFn: () => api<SetupData>('/auth/totp/setup', { method: 'POST' }),
    onSuccess: setData,
  });
  const verify = useMutation({
    mutationFn: () => api('/auth/totp/verify', { method: 'POST', body: { code } }),
    onSuccess: () => router.refresh(),
  });

  return (
    <Card className="mx-auto max-w-lg">
      <CardTitle>Double authentification (2FA)</CardTitle>
      {required && (
        <p className="mb-4 rounded-lg bg-warning/15 p-3 text-sm">
          La double authentification est obligatoire pour votre rôle. Activez-la pour accéder à l&apos;application.
        </p>
      )}
      {!data ? (
        <>
          <p className="mb-4 text-sm text-muted">
            Vous aurez besoin d&apos;une application d&apos;authentification (Google Authenticator, Microsoft Authenticator,
            Authy…).
          </p>
          <ErrorText>{start.error?.message}</ErrorText>
          <Button onClick={() => start.mutate()} disabled={start.isPending}>
            Commencer l&apos;activation
          </Button>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm">1. Scannez ce QR code avec votre application :</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={data.qrDataUrl} alt="QR code 2FA" className="mx-auto mb-3 size-48" />
          <p className="mb-4 break-all text-center text-xs text-muted">
            Ou saisissez la clé : <code>{data.secret}</code>
          </p>
          <p className="mb-2 text-sm">2. Saisissez le code à 6 chiffres affiché :</p>
          <Field label="Code">
            <input
              value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6}
              autoComplete="one-time-code" className={inputClass}
            />
          </Field>
          <ErrorText>{verify.error?.message}</ErrorText>
          <Button onClick={() => verify.mutate()} disabled={verify.isPending || code.length !== 6}>
            Activer
          </Button>
        </>
      )}
    </Card>
  );
}
