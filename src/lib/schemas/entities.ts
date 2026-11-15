import { z } from 'zod';

export const createEntitySchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, '2 à 10 lettres ou chiffres'),
  prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,5}$/, '2 à 5 lettres ou chiffres'),
});

export type CreateEntityInput = z.infer<typeof createEntitySchema>;
