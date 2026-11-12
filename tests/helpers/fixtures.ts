import type { CurrentUser } from '@/server/auth';
import type { Role } from '@/generated/prisma/enums';

export function makeActor(
  id: string,
  roles: { entityId: string; role: Role }[],
  opts: { stepUp?: boolean } = {},
): CurrentUser {
  return {
    id,
    email: `${id}@test.local`,
    fullName: id,
    sessionId: `session-${id}`,
    roles,
    stepUpUntil: opts.stepUp === false ? null : new Date(Date.now() + 5 * 60_000),
    totpEnabled: true,
    needsTotpSetup: false,
  };
}

export const META = { ip: '127.0.0.1', userAgent: 'vitest' };
