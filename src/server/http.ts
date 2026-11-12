import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { roleHasPermission, type Permission } from '@/lib/permissions';
import { getCurrentUser, requestMeta, type CurrentUser, type RequestMeta } from './auth';
import { prisma } from './db';
import { AppError } from './errors';

export interface HandlerContext {
  request: Request;
  params: Record<string, string>;
  /** Null uniquement si `auth: false`. */
  user: CurrentUser | null;
  meta: RequestMeta;
}

export interface HandlerOptions {
  /** false pour les routes publiques (login, health). Défaut : true. */
  auth?: boolean;
  /** L'utilisateur doit détenir cette permission dans au moins une entité. Le contrôle par entité se fait dans les services (assertCan). */
  permission?: Permission;
  /** Routes accessibles même si la 2FA obligatoire n'est pas encore activée (enrôlement, me, logout). */
  allowPending2fa?: boolean;
  /** Opération financière : l'en-tête Idempotency-Key est obligatoire, une répétition renvoie la réponse d'origine. */
  idempotent?: boolean;
}

type RouteContext = { params: Promise<Record<string, string>> };

function assertSameOrigin(request: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const appUrl = process.env.APP_URL;
  if (!appUrl) return; // non configuré (dev/tests)
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(appUrl).origin) {
    throw new AppError('BAD_ORIGIN', 403, 'Origine de la requête refusée');
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2002';
}

/**
 * Réserve la clé d'idempotence. Renvoie soit l'id de la réservation (exécuter l'opération),
 * soit la réponse mémorisée (répétition).
 */
async function reserveIdempotencyKey(
  user: CurrentUser,
  request: Request,
): Promise<{ id: string } | { replay: Response }> {
  const key = request.headers.get('idempotency-key');
  if (!key || key.length < 8 || key.length > 100) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 400, "En-tête Idempotency-Key obligatoire (8 à 100 caractères)");
  }
  const path = new URL(request.url).pathname;
  try {
    const row = await prisma.idempotencyKey.create({ data: { userId: user.id, key, method: request.method, path } });
    return { id: row.id };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const existing = await prisma.idempotencyKey.findUnique({ where: { userId_key: { userId: user.id, key } } });
    if (!existing) throw new AppError('IDEMPOTENCY_IN_PROGRESS', 409, 'Opération en cours');
    if (existing.method !== request.method || existing.path !== path) {
      throw new AppError('IDEMPOTENCY_KEY_REUSED', 422, "Cette clé d'idempotence a déjà servi pour une autre opération");
    }
    if (existing.responseStatus === null) {
      throw new AppError('IDEMPOTENCY_IN_PROGRESS', 409, 'Opération en cours, réessayez dans un instant');
    }
    return {
      replay: new Response(existing.responseBody, {
        status: existing.responseStatus,
        headers: { 'Content-Type': 'application/json', 'Idempotent-Replay': 'true' },
      }),
    };
  }
}

/**
 * Wrapper de tous les Route Handlers : CSRF (Origin), session, 2FA obligatoire, permission,
 * idempotence des opérations financières, conversion des erreurs.
 */
export function handler(
  fn: (ctx: HandlerContext) => Promise<Response>,
  options: HandlerOptions = {},
) {
  const { auth = true, permission, allowPending2fa = false, idempotent = false } = options;
  return async (request: Request, route?: RouteContext): Promise<Response> => {
    let reservation: string | null = null;
    try {
      assertSameOrigin(request);
      const params = route?.params ? await route.params : {};
      const user = auth ? await getCurrentUser() : null;
      if (auth && !user) throw new AppError('UNAUTHENTICATED', 401, 'Connexion requise');
      if (user?.needsTotpSetup && !allowPending2fa) {
        throw new AppError('TOTP_SETUP_REQUIRED', 403, 'Activez la double authentification pour continuer');
      }
      if (user && permission && !user.roles.some((r) => roleHasPermission(r.role, permission))) {
        throw new AppError('FORBIDDEN', 403, 'Action non autorisée');
      }

      if (idempotent && user) {
        const reserved = await reserveIdempotencyKey(user, request);
        if ('replay' in reserved) return reserved.replay;
        reservation = reserved.id;
      }

      const response = await fn({ request, params, user, meta: requestMeta(request) });

      if (reservation) {
        const body = await response.clone().text();
        await prisma.idempotencyKey.update({
          where: { id: reservation },
          data: { responseStatus: response.status, responseBody: body },
        });
      }
      return response;
    } catch (err) {
      // Échec : la clé est libérée pour permettre de réessayer après correction.
      if (reservation) await prisma.idempotencyKey.delete({ where: { id: reservation } }).catch(() => undefined);

      if (err instanceof AppError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message, details: err.details } },
          { status: err.httpStatus },
        );
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Données invalides', details: err.issues } },
          { status: 400 },
        );
      }
      console.error('Unhandled error', err);
      return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur interne' } }, { status: 500 });
    }
  };
}
