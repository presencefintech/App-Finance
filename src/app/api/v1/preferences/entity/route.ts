import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { handler } from '@/server/http';
import { ENTITY_COOKIE } from '@/server/entity-selection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ selection: z.string().min(1).max(20) });

/** Préférence d'affichage uniquement : l'accès aux données reste borné côté serveur par les droits. */
export const POST = handler(async ({ request }) => {
  const { selection } = schema.parse(await request.json());
  // Seules les entités de l'organisation de l'utilisateur sont sélectionnables (la RLS borne cette requête).
  if (selection !== 'ALL' && !(await prisma.entity.findFirst({ where: { code: selection }, select: { id: true } }))) {
    throw new AppError('VALIDATION_ERROR', 400, 'Entité inconnue');
  }
  (await cookies()).set(ENTITY_COOKIE, selection, {
    path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365, httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  });
  return NextResponse.json({ ok: true });
});
