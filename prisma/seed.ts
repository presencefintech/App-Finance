import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const sec = await prisma.entity.upsert({
    where: { code: 'SEC' }, update: {}, create: { code: 'SEC', name: 'SEC SARL' },
  });
  const ecole = await prisma.entity.upsert({
    where: { code: 'ECOLE' }, update: {}, create: { code: 'ECOLE', name: 'École' },
  });
  // Le mot de passe réel (argon2id) est défini en phase 1 ; placeholder inutilisable.
  const admin = await prisma.user.upsert({
    where: { email: 'admin@sec.local' },
    update: {},
    create: { email: 'admin@sec.local', fullName: 'Administrateur', passwordHash: '!unset' },
  });
  for (const entityId of [sec.id, ecole.id]) {
    await prisma.userEntityRole.upsert({
      where: { userId_entityId_role: { userId: admin.id, entityId, role: 'ADMIN' } },
      update: {}, create: { userId: admin.id, entityId, role: 'ADMIN' },
    });
  }
}

main().finally(() => prisma.$disconnect());
