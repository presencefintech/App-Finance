import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

/**
 * Crée un schéma Postgres jetable (test_xxx), y applique toutes les migrations,
 * et configure DATABASE_SCHEMA pour que '@/server/db' pointe dessus.
 * Ne touche jamais au schéma public (données de staging).
 */
export async function createTestDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis pour les tests (schéma jetable)');
  const schema = `test_${randomBytes(6).toString('hex')}`;
  if (!/^test_[0-9a-f]{12}$/.test(schema)) throw new Error('nom de schéma invalide');

  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);

  const dir = path.resolve(__dirname, '../../prisma/migrations');
  const migrations = fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort();
  for (const m of migrations) {
    await client.query(fs.readFileSync(path.join(dir, m, 'migration.sql'), 'utf8'));
  }

  process.env.DATABASE_SCHEMA = schema;
  process.env.DISABLE_2FA = 'false'; // les tests vérifient la 2FA, quel que soit le .env local
  process.env.ENCRYPTION_KEY = 'a'.repeat(64); // clé de test, jamais utilisée hors tests

  return {
    schema,
    async drop() {
      const { prisma } = await import('@/server/db');
      await prisma.$disconnect();
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
      await client.end();
    },
  };
}
