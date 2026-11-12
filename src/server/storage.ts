import 'server-only';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Stockage des pièces : bucket S3 compatible si S3_* est configuré,
 * sinon repli en base de données (Attachment.data) — suffisant pour staging.
 */
const s3Configured = () =>
  Boolean(process.env.S3_ENDPOINT && process.env.S3_BUCKET && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY);

let client: S3Client | null = null;
function s3(): S3Client {
  client ??= new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'auto',
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! },
  });
  return client;
}

export const storageMode = (): 's3' | 'db' => (s3Configured() ? 's3' : 'db');

/** Stocke le fichier ; renvoie les octets à garder en base si mode 'db'. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<{ data: Buffer | null }> {
  if (!s3Configured()) return { data: body };
  await s3().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
  return { data: null };
}

/** URL signée de courte durée (60 s) — uniquement en mode S3. */
export async function signedUrl(key: string, fileName: string): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET, Key: key,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
    }),
    { expiresIn: 60 },
  );
}
