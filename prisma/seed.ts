import 'dotenv/config';
import argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const UNSET = '!unset';

async function main() {
  const sec = await prisma.entity.upsert({
    where: { code: 'SEC' }, update: {}, create: { code: 'SEC', name: 'SEC SARL' },
  });
  const ecole = await prisma.entity.upsert({
    where: { code: 'ECOLE' }, update: {}, create: { code: 'ECOLE', name: 'École' },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@sec.local' },
    update: {},
    create: { email: 'admin@sec.local', fullName: 'Administrateur', passwordHash: UNSET },
  });

  // Le mot de passe initial vient de SEED_ADMIN_PASSWORD ; défini une seule fois (jamais écrasé ensuite).
  const initial = process.env.SEED_ADMIN_PASSWORD;
  if (initial && admin.passwordHash === UNSET) {
    const passwordHash = await argon2.hash(initial, { type: argon2.argon2id });
    await prisma.user.update({ where: { id: admin.id }, data: { passwordHash } });
    console.log('Mot de passe admin initialisé.');
  }

  // Catégories par défaut (modifiables dans Paramètres) — idempotent.
  const INCOME = ['Frais scolaires', 'Partenaires', 'Autres recettes'];
  const EXPENSE = ['Fournitures', 'Salaires', 'Transport', 'Maintenance', 'Frais bancaires', 'Demandes de fonds', 'Autres dépenses'];
  for (const entityId of [sec.id, ecole.id]) {
    for (const name of INCOME) {
      await prisma.category.upsert({ where: { entityId_kind_name: { entityId, kind: 'INCOME', name } }, update: {}, create: { entityId, kind: 'INCOME', name } });
    }
    for (const name of EXPENSE) {
      await prisma.category.upsert({ where: { entityId_kind_name: { entityId, kind: 'EXPENSE', name } }, update: {}, create: { entityId, kind: 'EXPENSE', name } });
    }
  }

  for (const entityId of [sec.id, ecole.id]) {
    await prisma.userEntityRole.upsert({
      where: { userId_entityId_role: { userId: admin.id, entityId, role: 'ADMIN' } },
      update: {}, create: { userId: admin.id, entityId, role: 'ADMIN' },
    });
  }
}

main().finally(() => prisma.$disconnect());
