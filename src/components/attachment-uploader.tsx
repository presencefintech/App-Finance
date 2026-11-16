'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import { Button, ErrorText } from '@/components/ui/form';

const MAX = 10 * 1024 * 1024;

/** Compresse les photos (côté client) avant envoi pour économiser la data mobile. */
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size < 400 * 1024) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
  return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }) : file;
}

export interface UploadedAttachment { id: string; fileName: string }

/**
 * `draft` : justificatif déposé avant l'opération (`targetId` = identifiant de l'entité) ; le fichier est renvoyé par
 * `onUploaded` pour être joint à l'opération à la création. Les autres cibles rafraîchissent la page.
 */
export function AttachmentUploader({
  targetType, targetId, kind = 'RECEIPT', label, onUploaded,
}: {
  targetType: 'fundRequest' | 'transaction' | 'draft'; targetId: string; kind?: string; label?: string;
  onUploaded?: (attachment: UploadedAttachment) => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async (original: File) => {
      const file = await compressImage(original);
      if (file.size > MAX) throw new Error('Fichier trop volumineux (10 Mo maximum)');
      const form = new FormData();
      form.set('file', file);
      form.set('targetType', targetType);
      form.set('targetId', targetId);
      form.set('kind', kind);
      const res = await fetch('/api/v1/attachments', {
        method: 'POST', body: form, headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      const body = (await res.json().catch(() => null)) as
        | (UploadedAttachment & { error?: { code?: string; message?: string } }) | null;
      if (!res.ok || !body?.id) {
        throw new ApiError(body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? 'Échec du dépôt', res.status);
      }
      return body;
    },
    onSuccess: (created) => {
      if (input.current) input.current.value = '';
      onUploaded?.({ id: created.id, fileName: created.fileName });
      if (targetType !== 'draft') router.refresh();
    },
  });

  return (
    <div>
      {/* capture="environment" : ouvre directement l'appareil photo arrière sur mobile (sauf brouillon : une facture est souvent un PDF) */}
      <input
        ref={input} type="file" accept="image/jpeg,image/png,application/pdf" capture={targetType === 'draft' ? undefined : 'environment'} hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          setLocalError(null);
          if (f) upload.mutate(f);
        }}
      />
      <ErrorText>{localError ?? upload.error?.message}</ErrorText>
      <Button type="button" variant="ghost" onClick={() => input.current?.click()} disabled={upload.isPending}>
        {upload.isPending ? 'Envoi…' : (label ?? 'Ajouter un justificatif (photo / PDF)')}
      </Button>
    </div>
  );
}
