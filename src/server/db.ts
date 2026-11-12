import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { currentOrg } from './tenant';

/**
 * Accès base de données, isolé par organisation.
 *
 * Chaque organisation a SON client Prisma, dont la connexion démarre avec `app.org_id=<id>` : toutes les requêtes
 * (y compris transactions interactives et SQL brut) sont alors filtrées par les politiques Row-Level Security de
 * Postgres. L'application se connecte avec un rôle SANS privilège spécial (`sec_app`) : un superutilisateur
 * contournerait la RLS.
 *
 *  - `prisma`      : client de l'organisation courante (contexte `tenant.ts`) ; sans contexte → « système ».
 *  - `systemDb()`  : connexion sans organisation. Ne voit aucune donnée métier ; sert à l'authentification.
 *  - `platformDb()`: rôle propriétaire (contourne la RLS) — réservé au module d'administration de la plateforme.
 */
const MAX_CLIENTS = 24;
const POOL_PER_ORG = 4;

const g = globalThis as unknown as {
  __sfcClients?: Map<string, PrismaClient>;
  __sfcPlatform?: PrismaClient;
  __sfcTestOrg?: string | null;
};
const clients = (g.__sfcClients ??= new Map<string, PrismaClient>());

function connectionUrl(base: string, orgId: string | null): string {
  const url = new URL(base);
  const opts: string[] = [];
  // Schéma dédié (tests uniquement) : appliqué au search_path du SQL brut ET aux requêtes Prisma.
  if (process.env.DATABASE_SCHEMA) opts.push(`-c search_path=${process.env.DATABASE_SCHEMA}`);
  if (orgId) opts.push(`-c app.org_id=${orgId}`);
  if (opts.length) url.searchParams.set('options', opts.join(' '));
  return url.toString();
}

function make(base: string, orgId: string | null, max: number): PrismaClient {
  const schema = process.env.DATABASE_SCHEMA;
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: connectionUrl(base, orgId), max }, schema ? { schema } : undefined),
  });
}

function appUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}

export function clientForOrg(orgId: string | null): PrismaClient {
  const key = orgId ?? '__system__';
  const existing = clients.get(key);
  if (existing) {
    clients.delete(key); // LRU : on le replace en dernier
    clients.set(key, existing);
    return existing;
  }
  const created = make(appUrl(), orgId, POOL_PER_ORG);
  clients.set(key, created);
  while (clients.size > MAX_CLIENTS) {
    const victimKey = [...clients.keys()].find((k) => k !== '__system__' && k !== key);
    if (!victimKey) break;
    const victim = clients.get(victimKey);
    clients.delete(victimKey);
    void victim?.$disconnect();
  }
  return created;
}

export const systemDb = (): PrismaClient => clientForOrg(null);

export function platformDb(): PrismaClient {
  g.__sfcPlatform ??= make(process.env.MIGRATION_DATABASE_URL ?? appUrl(), null, 2);
  return g.__sfcPlatform;
}

/** Tests : organisation par défaut quand aucun contexte n'est posé (jamais utilisé en dehors de Vitest). */
export function setTestOrg(orgId: string | null): void {
  if (!process.env.VITEST) throw new Error('setTestOrg est réservé aux tests');
  g.__sfcTestOrg = orgId;
}

function resolveOrg(): string | null {
  const ctx = currentOrg();
  if (ctx !== undefined) return ctx;
  return process.env.VITEST ? (g.__sfcTestOrg ?? null) : null;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = clientForOrg(resolveOrg());
    const value = Reflect.get(client, prop);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export async function disconnectAll(): Promise<void> {
  await Promise.all([...clients.values()].map((c) => c.$disconnect()));
  clients.clear();
  await g.__sfcPlatform?.$disconnect();
  g.__sfcPlatform = undefined;
}
