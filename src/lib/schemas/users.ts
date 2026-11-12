import { z } from 'zod';
import { Role } from '@/generated/prisma/enums';

const roleEnum = z.enum(Object.values(Role) as [Role, ...Role[]]);

export const roleAssignmentSchema = z.object({
  entityId: z.string().min(1),
  role: roleEnum,
});

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail invalide')),
  fullName: z.string().trim().min(2, 'Nom requis').max(120),
  password: z.string().min(12, '12 caractères minimum').max(200),
  roles: z.array(roleAssignmentSchema).default([]),
});

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  isActive: z.boolean().optional(),
});

export const setRolesSchema = z.object({ roles: z.array(roleAssignmentSchema) });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type RoleAssignment = z.infer<typeof roleAssignmentSchema>;
