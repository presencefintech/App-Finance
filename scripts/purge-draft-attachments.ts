/**
 * Supprime les justificatifs déposés mais jamais liés à une opération (formulaire abandonné) depuis plus de N heures
 * (24 par défaut). Une pièce liée à une opération ou à une demande de fonds n'est JAMAIS touchée.
 *
 *   MIGRATION_DATABASE_URL=… pnpm db:purge-draft-attachments [heures]
 *
 * À planifier une fois par jour (cron Railway, tâche planifiée…).
 */
import 'dotenv/config';
import { Client } from 'pg';
import { deleteObject } from '../src/server/storage';

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL (rôle propriétaire) est requis');
  const hours = Number(process.argv[2] ?? 24);
  if (!Number.isFinite(hours) || hours < 1) throw new Error('Nombre d’heures invalide');

  const client = new Client({ connectionString: url });
  await client.connect();
  let deleted = 0;
  let failed = 0;
  try {
    const { rows } = await client.query<{ id: string; storageKey: string }>(
      `SELECT "id", "storageKey" FROM "Attachment"
        WHERE "txId" IS NULL AND "fundRequestId" IS NULL AND "uploadedAt" < now() - ($1 || ' hours')::interval`,
      [String(hours)],
    );
    for (const r of rows) {
      try {
        await deleteObject(r.storageKey);
        // Mêmes critères qu'à la sélection : une pièce liée entre-temps ne disparaît pas.
        const res = await client.query('DELETE FROM "Attachment" WHERE "id" = $1 AND "txId" IS NULL AND "fundRequestId" IS NULL', [r.id]);
        deleted += res.rowCount ?? 0;
      } catch (e) {
        failed++;
        console.error(`Non supprimé : ${r.id} (${e instanceof Error ? e.message : 'erreur'})`);
      }
    }
  } finally {
    await client.end();
  }
  console.log(`Justificatifs en attente supprimés : ${deleted} ; en échec : ${failed}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
