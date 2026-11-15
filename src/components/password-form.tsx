'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui/card';
import { Button, ErrorText, Field, inputClass } from '@/components/ui/form';

/** Changement de son propre mot de passe (les autres appareils sont déconnectés). */
export function PasswordForm() {
  const [done, setDone] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const change = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) => api('/auth/password', { method: 'POST', body }),
    onSuccess: () => setDone(true),
  });

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const next = String(data.get('newPassword'));
    setDone(false);
    if (next !== String(data.get('confirm'))) return setMismatch(true);
    setMismatch(false);
    change.mutate({ currentPassword: String(data.get('currentPassword')), newPassword: next }, { onSuccess: () => form.reset() });
  }

  return (
    <Card>
      <CardTitle>Mot de passe</CardTitle>
      <form onSubmit={onSubmit} className="max-w-sm">
        <Field label="Mot de passe actuel">
          <input name="currentPassword" type="password" required autoComplete="current-password" className={inputClass} />
        </Field>
        <Field label="Nouveau mot de passe" hint="12 caractères minimum. Vos autres appareils seront déconnectés.">
          <input name="newPassword" type="password" required minLength={12} autoComplete="new-password" className={inputClass} />
        </Field>
        <Field label="Confirmer le nouveau mot de passe">
          <input name="confirm" type="password" required minLength={12} autoComplete="new-password" className={inputClass} />
        </Field>
        <ErrorText>{mismatch ? 'Les deux mots de passe ne correspondent pas' : change.error?.message}</ErrorText>
        {done && <p className="mb-3 text-sm text-primary">Mot de passe modifié.</p>}
        <Button type="submit" disabled={change.isPending}>{change.isPending ? 'Enregistrement…' : 'Changer le mot de passe'}</Button>
      </form>
    </Card>
  );
}
