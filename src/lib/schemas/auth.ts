import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail invalide')),
  password: z.string().min(1, 'Mot de passe requis').max(200),
  totp: z.string().trim().regex(/^\d{6}$/, 'Code à 6 chiffres').optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail invalide')),
});

export const resetPasswordSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/, 'Lien invalide'),
  newPassword: z.string().min(12, '12 caractères minimum').max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Mot de passe actuel requis').max(200),
  newPassword: z.string().min(12, '12 caractères minimum').max(200),
});

export const totpCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Code à 6 chiffres') });
