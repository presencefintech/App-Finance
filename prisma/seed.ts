/**
 * Seed de base (idempotent, exécuté à chaque démarrage) : les deux premiers clients de la plateforme, chacun
 * une ORGANISATION distincte et isolée, avec son entité et son administrateur ; plus l'administrateur de la
 * plateforme. S'exécute avec le rôle PROPRIÉTAIRE (MIGRATION_DATABASE_URL) : il crée les organisations, donc
 * contourne la RLS — c'est le seul endroit (avec le module plateforme) où c'est légitime.
 */
import 'dotenv/config';
import argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const UNSET = '!unset';
const EXPENSE = ['Fournitures', 'Salaires', 'Transport', 'Maintenance', 'Frais bancaires', 'Demandes de fonds', 'Autres dépenses'];

const CLIENTS = [
  { slug: 'sec-sarl', name: 'SEC SARL', entity: { code: 'SEC', prefix: 'SEC', name: 'SEC SARL' }, admin: { email: 'admin@sec.local', fullName: 'Administrateur SEC SARL' }, income: ['Partenaires', 'Prestations', 'Autres recettes'] },
  { slug: 'ecole', name: 'École', entity: { code: 'ECOLE', prefix: 'ECO', name: 'École' }, admin: { email: 'admin@ecole.local', fullName: 'Administrateur École' }, income: ['Frais scolaires', 'Partenaires', 'Autres recettes'] },
];

async function hash(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
}

async function main() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  for (const c of CLIENTS) {
    const org = await prisma.organization.upsert({ where: { slug: c.slug }, update: {}, create: { slug: c.slug, name: c.name } });
    const entity =
      (await prisma.entity.findFirst({ where: { organizationId: org.id, code: c.entity.code } })) ??
      (await prisma.entity.create({ data: { organizationId: org.id, ...c.entity } }));

    for (const name of c.income) {
      const exists = await prisma.category.findFirst({ where: { entityId: entity.id, kind: 'INCOME', name } });
      if (!exists) await prisma.category.create({ data: { organizationId: org.id, entityId: entity.id, kind: 'INCOME', name } });
    }
    for (const name of EXPENSE) {
      const exists = await prisma.category.findFirst({ where: { entityId: entity.id, kind: 'EXPENSE', name } });
      if (!exists) await prisma.category.create({ data: { organizationId: org.id, entityId: entity.id, kind: 'EXPENSE', name } });
    }

    const admin = await prisma.user.upsert({
      where: { email: c.admin.email }, update: {},
      create: { email: c.admin.email, fullName: c.admin.fullName, passwordHash: UNSET, organizationId: org.id },
    });
    // Le mot de passe initial vient de SEED_ADMIN_PASSWORD ; défini une seule fois (jamais écrasé ensuite).
    if (adminPassword && admin.passwordHash === UNSET) {
      await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: await hash(adminPassword) } });
      console.log(`Mot de passe initialisé : ${c.admin.email}`);
    }
    await prisma.userEntityRole.upsert({
      where: { userId_entityId_role: { userId: admin.id, entityId: entity.id, role: 'ADMIN' } },
      update: {}, create: { organizationId: org.id, userId: admin.id, entityId: entity.id, role: 'ADMIN' },
    });
  }

  // Administrateur de la PLATEFORME : aucune organisation, aucun accès aux données financières.
  const platformPassword = process.env.SEED_PLATFORM_PASSWORD;
  if (platformPassword) {
    const existing = await prisma.user.findUnique({ where: { email: 'platform@sec.local' } });
    if (!existing) {
      await prisma.user.create({
        data: { email: 'platform@sec.local', fullName: 'Administrateur de la plateforme', passwordHash: await hash(platformPassword), isPlatformAdmin: true, organizationId: null },
      });
      console.log('Administrateur de plateforme créé : platform@sec.local');
    }
  }
}

main().finally(() => prisma.$disconnect());
