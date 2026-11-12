import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail invalide')),
  password: z.string().min(1, 'Mot de passe requis').max(200),
  totp: z.string().trim().regex(/^\d{6}$/, 'Code à 6 chiffres').optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const totpCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Code à 6 chiffres') });
