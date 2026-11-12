import { z } from 'zod';

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Identifiant : lettres minuscules, chiffres et tirets').min(2).max(40),
  entityName: z.string().trim().min(2).max(120),
  entityCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, '2 à 10 lettres ou chiffres'),
  entityPrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,5}$/, '2 à 5 lettres ou chiffres'),
  adminEmail: z.string().trim().toLowerCase().pipe(z.email('E-mail invalide')),
  adminName: z.string().trim().min(2).max(120),
  adminPassword: z.string().min(12, '12 caractères minimum').max(200),
});

export const setOrganizationActiveSchema = z.object({ isActive: z.boolean() });

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
