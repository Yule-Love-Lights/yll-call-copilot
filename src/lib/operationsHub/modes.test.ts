import { describe, expect, it } from 'vitest';
import { buildHubActor } from '@/lib/auth/capabilities';
import {
  canShowDepartmentModeSwitcher,
  modeForDepartment,
  resolveHubLandingMode,
} from './modes';

function actor(role: 'office' | 'advertising' | 'installer' | 'owner', memberships: readonly ('office' | 'advertising' | 'installer')[]) {
  const result = buildHubActor({
    authUserId: `auth-${role}`,
    employeeId: `employee-${role}`,
    compatibilityEmail: `${role}@example.com`,
    employeeRole: role,
    memberships,
    membershipVersion: 1,
  });
  if (!result) throw new Error('expected actor');
  return result;
}

describe('Operations Hub mode routing', () => {
  it('always lands Owner/Admin in Management without a department switcher', () => {
    const owner = actor('owner', ['office', 'advertising', 'installer']);

    expect(resolveHubLandingMode(owner, 'office')).toBe('management');
    expect(canShowDepartmentModeSwitcher(owner)).toBe(false);
  });

  it('uses only an explicit active primary home mode for employees', () => {
    const office = actor('office', ['office']);

    expect(resolveHubLandingMode(office, 'office')).toBe('office');
    expect(resolveHubLandingMode(office, null)).toBeNull();
    expect(resolveHubLandingMode(office, 'advertising')).toBeNull();
  });

  it('shows a switcher only to a non-owner with multiple active memberships', () => {
    const multiDepartmentOffice = actor('office', ['office', 'advertising']);

    expect(canShowDepartmentModeSwitcher(multiDepartmentOffice)).toBe(true);
    expect(modeForDepartment('installer')).toBe('installer');
  });
});
