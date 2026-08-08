import { describe, expect, it } from 'vitest';
import { buildLegacyActor, hasCapability, parseAppUserRole } from './capabilities';

describe('capability policy', () => {
  it('normalizes only closed role values', () => {
    expect(parseAppUserRole('  ADMIN  ')).toBe('admin');
    expect(parseAppUserRole('installer')).toBe('installer');
    expect(parseAppUserRole('manger')).toBeNull();
    expect(parseAppUserRole(null)).toBeNull();
  });

  it('keeps Manager in the test vocabulary but never creates a V1 actor', () => {
    expect(
      buildLegacyActor({
        authUserId: 'auth-1',
        employeeId: 'employee-1',
        email: 'manager@example.com',
        appUserRole: 'manager',
      }),
    ).toBeNull();
  });

  it('requires an explicit capability instead of inferring access from membership', () => {
    const actor = buildLegacyActor({
      authUserId: 'auth-1',
      employeeId: 'employee-1',
      email: 'installer@example.com',
      appUserRole: 'installer',
    });
    if (!actor) throw new Error('expected actor');

    expect(actor.memberships).toEqual(['installer']);
    expect(hasCapability(actor, 'installer.navigation')).toBe(true);
    expect(hasCapability(actor, 'office.tools.use')).toBe(false);
  });
});
