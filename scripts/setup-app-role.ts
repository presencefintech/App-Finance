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

    // Rôle de la PLATEFORME (création/suspension d'organisations) : contourne la RLS mais n'a de droits que sur les
    // quelques tables de gestion des organisations — aucune table financière, aucun DDL, jamais superutilisateur.
    const platformPassword = process.env.PLATFORM_DB_PASSWORD;
    if (platformPassword) {
      if (platformPassword.length < 16) throw new Error('PLATFORM_DB_PASSWORD : 16 caractères minimum');
      await client.query("DO $body$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sec_platform') THEN CREATE ROLE sec_platform NOLOGIN; END IF; END $body$");
      await client.query(`ALTER ROLE sec_platform WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS PASSWORD ${client.escapeLiteral(platformPassword)}`);
      await client.query('GRANT USAGE ON SCHEMA public TO sec_platform');
      const grants: Record<string, string> = {
        Organization: 'SELECT, INSERT, UPDATE', Entity: 'SELECT, INSERT', User: 'SELECT, INSERT', UserEntityRole: 'SELECT, INSERT',
        Category: 'SELECT, INSERT', AuditLog: 'INSERT', Session: 'SELECT, DELETE',
      };
      await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM sec_platform`);
      for (const [table, privileges] of Object.entries(grants)) await client.query(`GRANT ${privileges} ON "${table}" TO sec_platform`);
      console.log('Rôle de plateforme sec_platform prêt (droits limités à la gestion des organisations).');
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
