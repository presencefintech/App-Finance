/**
 * Déplace vers le bucket S3 les justificatifs encore stockés en base (Attachment.data).
 * Idempotent et prudent : chaque fichier est envoyé, RELU depuis le bucket, son empreinte SHA-256 comparée à celle
 * enregistrée, et seulement alors retiré de la base. En cas de doute le fichier reste en base.
 *
 *   MIGRATION_DATABASE_URL=… S3_ENDPOINT=… S3_BUCKET=… S3_ACCESS_KEY=… S3_SECRET_KEY=… pnpm db:attachments-to-s3
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { getObject, putObject, storageMode } from '../src/server/storage';

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL (rôle propriétaire) est requis');
  if (storageMode() !== 's3') throw new Error('S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY et S3_SECRET_KEY sont requis');

  const client = new Client({ connectionString: url });
  await client.connect();
  let moved = 0;
  let kept = 0;
  try {
    const { rows } = await client.query<{ id: string; storageKey: string; mimeType: string; sha256: string; data: Buffer }>(
      'SELECT "id", "storageKey", "mimeType", "sha256", "data" FROM "Attachment" WHERE "data" IS NOT NULL',
    );
    for (const r of rows) {
      try {
        if (createHash('sha256').update(r.data).digest('hex') !== r.sha256) throw new Error('empreinte en base différente');
        await putObject(r.storageKey, r.data, r.mimeType);
        const back = await getObject(r.storageKey);
        if (createHash('sha256').update(back).digest('hex') !== r.sha256) throw new Error('relecture du bucket différente');
        await client.query('UPDATE "Attachment" SET "data" = NULL WHERE "id" = $1', [r.id]);
        moved++;
      } catch (e) {
        kept++;
        console.error(`Conservé en base : ${r.id} (${e instanceof Error ? e.message : 'erreur'})`);
      }
    }
  } finally {
    await client.end();
  }
  console.log(`Justificatifs déplacés vers le bucket : ${moved} ; laissés en base : ${kept}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
