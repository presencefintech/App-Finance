/**
 * Pose le mot de passe du rôle applicatif `sec_app` (créé SANS login par la migration multi-tenancy).
 * L'application se connecte avec ce rôle : sans privilège spécial, il est soumis à la Row-Level Security
 * (un superutilisateur la contournerait). Idempotent ; à lancer après `prisma migrate deploy`.
 *
 *   MIGRATION_DATABASE_URL=… APP_DB_PASSWORD=… pnpm db:setup-role
 */
import 'dotenv/config';
import { Client } from 'pg';

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  const password = process.env.APP_DB_PASSWORD;
  if (!url) throw new Error('MIGRATION_DATABASE_URL (rôle propriétaire) est requis');
  if (!password || password.length < 16) throw new Error('APP_DB_PASSWORD (16 caractères minimum) est requis');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sec_app') THEN CREATE ROLE sec_app NOLOGIN; END IF; END $$");
    // Garde-fous : jamais de superutilisateur ni de contournement de la RLS pour l'application.
    await client.query(`ALTER ROLE sec_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${client.escapeLiteral(password)}`);
    const { rows } = await client.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'sec_app'");
    if (rows[0]?.rolsuper || rows[0]?.rolbypassrls) throw new Error('sec_app ne doit ni être superutilisateur ni contourner la RLS');
    console.log('Rôle applicatif sec_app prêt (sans privilège spécial, soumis à la RLS).');
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
