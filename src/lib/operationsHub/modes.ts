import type { Department, HubActor } from '@/lib/auth/capabilities';

export const HUB_MODES = ['management', 'office', 'advertising', 'installer'] as const;

export type HubMode = (typeof HUB_MODES)[number];
export type EmployeeHomeMode = Exclude<HubMode, 'management'>;

export function resolveHubLandingMode(
  actor: HubActor,
  primaryHomeMode: EmployeeHomeMode | null,
): HubMode | null {
  if (actor.role === 'owner_admin') return 'management';
  if (!primaryHomeMode || !actor.memberships.includes(primaryHomeMode)) return null;
  return primaryHomeMode;
}

export function canShowDepartmentModeSwitcher(actor: HubActor): boolean {
  return actor.role !== 'owner_admin' && actor.memberships.length > 1;
}

export function modeForDepartment(department: Department): EmployeeHomeMode {
  return department;
}
