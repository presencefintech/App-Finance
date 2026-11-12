import { describe, expect, it } from 'vitest';
import { can, roleHasPermission, ROLE_PERMISSIONS } from '../src/lib/permissions';

const ECOLE = 'entity-ecole';
const SEC = 'entity-sec';

describe('permissions', () => {
  it("un CASHIER de l'École n'a aucun droit sur SEC", () => {
    const roles = [{ entityId: ECOLE, role: 'CASHIER' as const }];
    expect(can(roles, 'fundRequest.disburse', ECOLE)).toBe(true);
    expect(can(roles, 'fundRequest.disburse', SEC)).toBe(false);
    expect(can(roles, 'transaction.record', SEC)).toBe(false);
  });

  it("ADMIN n'enregistre aucune opération financière", () => {
    for (const p of ['transaction.record', 'fundRequest.disburse', 'fundRequest.approve'] as const) {
      expect(roleHasPermission('ADMIN', p)).toBe(false);
    }
  });

  it('le demandeur ne peut ni approuver ni décaisser', () => {
    expect(roleHasPermission('REQUESTER', 'fundRequest.approve')).toBe(false);
    expect(roleHasPermission('REQUESTER', 'fundRequest.disburse')).toBe(false);
  });

  it('VIEWER est en lecture seule', () => {
    expect(ROLE_PERMISSIONS.VIEWER).toEqual(['account.read', 'report.read']);
  });

  it('un rôle par entité : CONTROLLER sur SEC et VIEWER sur ÉCOLE', () => {
    const roles = [
      { entityId: SEC, role: 'CONTROLLER' as const },
      { entityId: ECOLE, role: 'VIEWER' as const },
    ];
    expect(can(roles, 'transaction.reverse', SEC)).toBe(true);
    expect(can(roles, 'transaction.reverse', ECOLE)).toBe(false);
  });
});
