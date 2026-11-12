import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { cache } from 'react';

/**
 * Contexte d'organisation (tenant) de la requête en cours.
 *
 *  - Route Handlers : `runInOrg()` ouvre un contexte AsyncLocalStorage (fiable pour toute la chaîne d'appels).
 *  - Server Components : les composants asynchrones sont rendus de façon concurrente, hors de la pile du
 *    parent ; on lie donc l'organisation à la portée de la requête via `cache()` de React, posée dès que
 *    `getCurrentUser()` a identifié l'utilisateur.
 *
 * `undefined` = aucun contexte (la couche base de données retombe alors sur la connexion « système »,
 * qui ne voit AUCUNE donnée métier : échec fermé).
 */
const als = new AsyncLocalStorage<{ orgId: string | null }>();
const rscScope = cache(() => ({ orgId: undefined as string | null | undefined }));

export function runInOrg<T>(orgId: string | null, fn: () => Promise<T>): Promise<T> {
  return als.run({ orgId }, fn);
}

export function bindRscTenant(orgId: string | null): void {
  rscScope().orgId = orgId;
}

export function currentOrg(): string | null | undefined {
  const fromAls = als.getStore();
  if (fromAls) return fromAls.orgId;
  try {
    return rscScope().orgId;
  } catch {
    return undefined; // hors rendu React (scripts, tests)
  }
}
