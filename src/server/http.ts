import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from './errors';

export interface HandlerContext {
  request: Request;
  params: Record<string, string>;
}

type RouteContext = { params: Promise<Record<string, string>> };

/**
 * Wrapper de tous les Route Handlers.
 * Phase 0 : conversion des erreurs. Phase 1 ajoutera session, permissions,
 * vérification Origin (CSRF) ; phase 2 l'en-tête Idempotency-Key.
 */
export function handler(fn: (ctx: HandlerContext) => Promise<Response>) {
  return async (request: Request, route: RouteContext): Promise<Response> => {
    try {
      const params = route?.params ? await route.params : {};
      return await fn({ request, params });
    } catch (err) {
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
      return NextResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Erreur interne' } },
        { status: 500 },
      );
    }
  };
}
