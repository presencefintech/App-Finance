import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

export interface TestOrg { id: string; name: string }

/** Retire la création du rôle sec_app et ses droits sur « public » (de « DO $$ » jusqu'à ALTER DEFAULT PRIVILEGES…;). */
function stripSharedRoleSetup(sql: string): string {
  const start = sql.indexOf("IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sec_app')");
  if (start < 0) return sql;
  const doStart = sql.lastIndexOf('DO $$', start);
  const marker = 'ALTER DEFAULT PRIVILEGES IN SCHEMA public';
  const defaults = sql.indexOf(marker, start);
  if (doStart < 0 || defaults < 0) return sql;
  const end = sql.indexOf(';', defaults) + 1;
  return `${sql.slice(0, doStart)}-- (rôle sec_app déjà en place)${sql.slice(end)}`;
}

/**
 * Crée un schéma Postgres jetable (test_xxx), y applique toutes les migrations, crée UNE organisation de test et
 * configure '@/server/db' pour qu'il s'y connecte avec le rôle APPLICATIF restreint (sec_app) : la Row-Level
 * Security est donc exercée par TOUS les tests (un superutilisateur la contournerait).
 * Ne touche jamais au schéma public (données de staging).
 */
export async function createTestDb(opts: { orgs?: string[] } = {}) {
  const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!adminUrl) throw new Error('MIGRATION_DATABASE_URL (ou DATABASE_URL) requis pour les tests');
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.includes('sec_app')) {
    throw new Error('DATABASE_URL doit utiliser le rôle applicatif sec_app (RLS) : voir pnpm db:setup-role');
  }
  const schema = `test_${randomBytes(6).toString('hex')}`;
  if (!/^test_[0-9a-f]{12}$/.test(schema)) throw new Error('nom de schéma invalide');

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`SET search_path TO "${schema}"`);

  const dir = path.resolve(__dirname, '../../prisma/migrations');
  const migrations = fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort();
  for (const m of migrations) {
    // Le rôle sec_app est global à la base : on ne rejoue PAS sa création ni ses GRANT du schéma public à chaque
    // fichier de test (ils se marcheraient dessus : « tuple concurrently updated »). Il existe déjà (pnpm db:setup-role).
    await admin.query(stripSharedRoleSetup(fs.readFileSync(path.join(dir, m, 'migration.sql'), 'utf8')));
  }

  // Droits du rôle applicatif sur le schéma de test (les migrations ne couvrent que « public »).
  await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO sec_app`);
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO sec_app`);

  const names = opts.orgs ?? ['Organisation de test'];
  const orgs: TestOrg[] = [];
  for (const name of names) {
    const id = `org_${randomBytes(6).toString('hex')}`;
    await admin.query('INSERT INTO "Organization" ("id", "name", "slug") VALUES ($1, $2, $3)', [id, name, id]);
    orgs.push({ id, name });
  }

  process.env.DATABASE_SCHEMA = schema;
  process.env.DISABLE_2FA = 'false'; // les tests vérifient la 2FA, quel que soit le .env local
  process.env.ENCRYPTION_KEY = 'a'.repeat(64); // clé de test, jamais utilisée hors tests
  process.env.TEST_ORG_ID = orgs[0]!.id;

  const dbModule = await import('@/server/db');
  dbModule.setTestOrg(orgs[0]!.id); // organisation par défaut des tests (les autres via runInOrg)

  return {
    schema,
    orgs,
    org: orgs[0]!,
    /** SQL en tant que PROPRIÉTAIRE (contourne la RLS) : réservé aux vérifications d'infrastructure. */
    admin,
    async drop() {
      await dbModule.disconnectAll();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}
