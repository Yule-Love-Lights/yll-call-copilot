import { describe, expect, it } from 'vitest';
import { buildHubActor, hasCapability, parseOpsEmployeeRole } from './capabilities';

describe('capability policy', () => {
  it('normalizes only closed employee role values', () => {
    expect(parseOpsEmployeeRole('  ADMIN  ')).toBe('admin');
    expect(parseOpsEmployeeRole('installer')).toBe('installer');
    expect(parseOpsEmployeeRole('rep')).toBeNull();
    expect(parseOpsEmployeeRole('manger')).toBeNull();
    expect(parseOpsEmployeeRole(null)).toBeNull();
  });

  it('keeps Manager in the test vocabulary but never creates a V1 actor', () => {
    expect(
      buildHubActor({
        authUserId: 'auth-1',
        employeeId: 'employee-1',
        compatibilityEmail: 'manager@example.com',
        employeeRole: 'manager',
        memberships: ['office'],
        membershipVersion: 1,
      }),
    ).toBeNull();
  });

  it('uses the stored membership snapshot instead of inferring memberships from role', () => {
    const actor = buildHubActor({
      authUserId: 'auth-1',
      employeeId: 'employee-1',
      compatibilityEmail: 'installer@example.com',
      employeeRole: 'installer',
      memberships: ['installer', 'office'],
      membershipVersion: 7,
    });
    if (!actor) throw new Error('expected actor');

    expect(actor.memberships).toEqual(['office', 'installer']);
    expect(actor.membershipVersion).toBe(7);
    expect(hasCapability(actor, 'installer.navigation')).toBe(true);
    expect(hasCapability(actor, 'office.tools.use')).toBe(false);
  });

  it('does not invent management as a department membership for Owner/Admin', () => {
    const actor = buildHubActor({
      authUserId: 'auth-1',
      employeeId: 'employee-1',
      compatibilityEmail: 'owner@example.com',
      employeeRole: 'owner',
      memberships: ['office', 'advertising', 'installer'],
      membershipVersion: 2,
    });
    if (!actor) throw new Error('expected actor');

    expect(actor.memberships).toEqual(['office', 'advertising', 'installer']);
    expect(actor.role).toBe('owner_admin');
    expect(hasCapability(actor, 'operations.admin')).toBe(true);
  });

  it('adds only navigation capabilities from secondary department memberships', () => {
    const actor = buildHubActor({
      authUserId: 'auth-1',
      employeeId: 'employee-1',
      compatibilityEmail: 'office@example.com',
      employeeRole: 'office',
      memberships: ['office', 'advertising', 'installer'],
      membershipVersion: 4,
    });
    if (!actor) throw new Error('expected actor');

    expect(hasCapability(actor, 'advertising.navigation')).toBe(true);
    expect(hasCapability(actor, 'installer.navigation')).toBe(true);
    expect(hasCapability(actor, 'office.tools.use')).toBe(true);
    expect(hasCapability(actor, 'operations.admin')).toBe(false);
    expect(hasCapability(actor, 'office.coaching.team.read')).toBe(false);
    expect(hasCapability(actor, 'office.job_operations')).toBe(false);
  });
});
