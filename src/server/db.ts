import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  let connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  // Schéma dédié (tests uniquement) : appliqué aux requêtes Prisma ET au search_path du SQL brut.
  const schema = process.env.DATABASE_SCHEMA;
  if (schema) {
    const url = new URL(connectionString);
    url.searchParams.set('options', `-c search_path=${schema}`);
    connectionString = url.toString();
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }, schema ? { schema } : undefined) });
}

export const prisma = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
