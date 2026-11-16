import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { AttachmentKind } from '@/generated/prisma/enums';
import { writeAudit } from '@/server/audit';
import type { CurrentUser, RequestMeta } from '@/server/auth';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { accessibleEntityIds, assertCan } from '@/server/permissions';
import { getObject, putObject } from '@/server/storage';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 Mo (SPEC §2.3)
const ALLOWED = ['image/jpeg', 'image/png', 'application/pdf'] as const;

/** Vérifie la signature binaire : le type déclaré par le client ne suffit pas. */
function sniff(buf: Buffer): (typeof ALLOWED)[number] | null {
  if (buf.length > 4 && buf.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

/** `draft` : justificatif déposé avant l'opération, rattaché à l'entité en attendant d'être lié (voir evidence.ts). */
export type AttachmentTarget =
  | { type: 'fundRequest'; id: string }
  | { type: 'transaction'; id: string }
  | { type: 'draft'; entityId: string };

/** Résout la cible, applique l'isolation d'entité et vérifie le droit de déposer. */
async function resolveTarget(actor: CurrentUser, target: AttachmentTarget, forUpload: boolean) {
  if (target.type === 'draft') {
    if (!accessibleEntityIds(actor).includes(target.entityId)) throw new AppError('NOT_FOUND', 404, 'Introuvable');
    assertCan(actor, 'transaction.record', target.entityId);
    return { entityId: target.entityId, fundRequestId: null as string | null, txId: null as string | null };
  }
  if (target.type === 'fundRequest') {
    const req = await prisma.fundRequest.findUnique({ where: { id: target.id } });
    if (!req || !accessibleEntityIds(actor).includes(req.entityId)) throw new AppError('NOT_FOUND', 404, 'Introuvable');
    const isRequester = req.requesterId === actor.id;
    const privileged = actor.roles.some(
      (r) => r.entityId === req.entityId && ['CONTROLLER', 'DIRECTOR', 'CASHIER', 'VIEWER'].includes(r.role),
    );
    if (!isRequester && !privileged) throw new AppError('NOT_FOUND', 404, 'Introuvable');
    if (forUpload) {
      const canUpload = isRequester || actor.roles.some((r) => r.entityId === req.entityId && r.role === 'CONTROLLER');
      if (!canUpload) throw new AppError('FORBIDDEN', 403, 'Dépôt non autorisé');
      if (['CLOSED', 'CANCELLED', 'REJECTED'].includes(req.status)) {
        throw new AppError('INVALID_STATE', 409, 'Cette demande est terminée : plus de dépôt possible');
      }
    }
    return { entityId: req.entityId, fundRequestId: req.id, txId: null as string | null };
  }
  const tx = await prisma.financialTransaction.findUnique({ where: { id: target.id }, select: { id: true, entityId: true } });
  if (!tx || !accessibleEntityIds(actor).includes(tx.entityId)) throw new AppError('NOT_FOUND', 404, 'Introuvable');
  if (forUpload) assertCan(actor, 'transaction.record', tx.entityId);
  return { entityId: tx.entityId, fundRequestId: null as string | null, txId: tx.id };
}

export async function uploadAttachment(
  actor: CurrentUser,
  input: { target: AttachmentTarget; kind: AttachmentKind; fileName: string; declaredType: string; bytes: Buffer },
  meta: RequestMeta,
) {
  if (input.bytes.length === 0) throw new AppError('VALIDATION_ERROR', 400, 'Fichier vide');
  if (input.bytes.length > MAX_UPLOAD_BYTES) throw new AppError('FILE_TOO_LARGE', 413, 'Fichier trop volumineux (10 Mo maximum)');
  const mime = sniff(input.bytes);
  if (!mime) throw new AppError('UNSUPPORTED_FILE_TYPE', 415, 'Types autorisés : JPEG, PNG, PDF');
  if (!(ALLOWED as readonly string[]).includes(input.declaredType) || input.declaredType !== mime) {
    throw new AppError('UNSUPPORTED_FILE_TYPE', 415, 'Le contenu du fichier ne correspond pas à son type');
  }

  const resolved = await resolveTarget(actor, input.target, true);
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const storageKey = `${resolved.entityId}/${randomUUID()}`;
  const stored = await putObject(storageKey, input.bytes, mime);
  const safeName = input.fileName.replace(/[^\w.\- ()éèàùçÉÈÀÙÇ]/g, '_').slice(0, 150) || 'document';

  return prisma.$transaction(async (tx) => {
    const row = await tx.attachment.create({
      data: {
        storageKey, fileName: safeName, mimeType: mime, size: input.bytes.length, sha256, kind: input.kind,
        data: stored.data ? new Uint8Array(stored.data) : null, uploadedById: actor.id,
        entityId: resolved.entityId, fundRequestId: resolved.fundRequestId, txId: resolved.txId,
      },
      select: { id: true, fileName: true, mimeType: true, size: true, kind: true, sha256: true, uploadedAt: true },
    });
    await writeAudit(tx, {
      actorId: actor.id, action: 'attachment.upload', entityType: 'Attachment', entityId: row.id,
      after: { fileName: row.fileName, sha256, kind: row.kind, size: row.size }, ip: meta.ip,
    });
    return row;
  });
}

async function loadForRead(actor: CurrentUser, id: string) {
  const att = await prisma.attachment.findUnique({ where: { id } });
  if (!att) throw new AppError('NOT_FOUND', 404, 'Introuvable');
  if (!att.txId && !att.fundRequestId) {
    // Pièce en attente (pas encore liée à une opération) : visible uniquement par celui qui l'a déposée.
    if (att.uploadedById !== actor.id || !accessibleEntityIds(actor).includes(att.entityId)) {
      throw new AppError('NOT_FOUND', 404, 'Introuvable');
    }
    return att;
  }
  await resolveTarget(
    actor,
    att.fundRequestId ? { type: 'fundRequest', id: att.fundRequestId } : { type: 'transaction', id: att.txId ?? '' },
    false,
  );
  return att;
}

/**
 * URL de téléchargement : toujours la route authentifiée du serveur, que le fichier soit en base ou dans le bucket.
 * Les droits sont ainsi contrôlés à chaque accès, et l'aperçu (image/PDF) reste conforme à la politique de contenu.
 */
export async function getAttachmentUrl(actor: CurrentUser, id: string, meta: RequestMeta) {
  await loadForRead(actor, id);
  await prisma.$transaction((tx) =>
    writeAudit(tx, { actorId: actor.id, action: 'attachment.download', entityType: 'Attachment', entityId: id, ip: meta.ip }),
  );
  return { url: `/api/v1/attachments/${id}/file` };
}

export async function readAttachmentFile(actor: CurrentUser, id: string) {
  const att = await loadForRead(actor, id);
  // Fichier en base (staging / anciens fichiers) ou dans le bucket S3 (clé = storageKey).
  const bytes = att.data ? Buffer.from(att.data) : await getObject(att.storageKey);
  if (createHash('sha256').update(bytes).digest('hex') !== att.sha256) {
    throw new AppError('INTEGRITY_ERROR', 500, 'Le fichier est altéré (empreinte différente) : contactez l’administrateur');
  }
  return { bytes, mimeType: att.mimeType, fileName: att.fileName };
}

/** Pièces rattachées à une opération (scans de documents signés, justificatifs). Même isolation d'entité que la lecture. */
export async function listForTransaction(actor: CurrentUser, txId: string) {
  await resolveTarget(actor, { type: 'transaction', id: txId }, false);
  return prisma.attachment.findMany({
    where: { txId }, orderBy: { uploadedAt: 'asc' },
    select: { id: true, fileName: true, mimeType: true, size: true, kind: true, uploadedAt: true, sha256: true },
  });
}

/** Types de pièces qui comptent comme « justificatif » (les scans de documents signés et les relevés n'en sont pas). */
export const EVIDENCE_KINDS: AttachmentKind[] = ['INVOICE', 'RECEIPT', 'OTHER'];

/** Nombre de justificatifs par opération, en une seule requête (listes). Entité inaccessible ⇒ aucun résultat. */
export async function evidenceCountsByTxId(actor: CurrentUser, entityId: string, txIds: string[]): Promise<Map<string, number>> {
  if (txIds.length === 0 || !accessibleEntityIds(actor).includes(entityId)) return new Map();
  const rows = await prisma.attachment.groupBy({
    by: ['txId'], where: { entityId, txId: { in: txIds }, kind: { in: EVIDENCE_KINDS } }, _count: { _all: true },
  });
  return new Map(rows.flatMap((r) => (r.txId ? [[r.txId, r._count._all] as const] : [])));
}

/** Même chose, indexé par référence d'opération (les listes de recettes et de dépenses n'exposent pas l'identifiant du grand livre). */
export async function evidenceCountsByReference(actor: CurrentUser, entityId: string, references: string[]): Promise<Map<string, number>> {
  if (references.length === 0 || !accessibleEntityIds(actor).includes(entityId)) return new Map();
  const txs = await prisma.financialTransaction.findMany({ where: { entityId, reference: { in: references } }, select: { id: true, reference: true } });
  const counts = await evidenceCountsByTxId(actor, entityId, txs.map((t) => t.id));
  return new Map(txs.map((t) => [t.reference, counts.get(t.id) ?? 0]));
}
