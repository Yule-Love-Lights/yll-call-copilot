export const DEPARTMENTS = [
  'office',
  'advertising',
  'installer',
  'management',
] as const;

export type Department = (typeof DEPARTMENTS)[number];

// Capability names are Hub-local policy labels. They are not cross-repository
// claims. The integration contract does not yet define how capabilities are
// transported to, or verified by, the Quote Tool.
export const CAPABILITIES = [
  'internal_public.read',
  'office.tools.use',
  'office.analytics.read',
  'office.calls.work',
  'office.customer.search',
  'office.coaching.self',
  'office.coaching.team.read',
  'office.coaching.settings.manage',
  'office.knowledge.read',
  'office.knowledge.manage',
  'office.pipeline.run',
  'office.scoreboard.self',
  'office.scoreboard.manage',
  'office.second_mile.work',
  'office.second_mile.send',
  'office.job_operations',
  'advertising.navigation',
  'installer.navigation',
  'operations.admin',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const APP_USER_ROLES = [
  'rep',
  'office',
  'advertising',
  'installer',
  'owner',
  'admin',
  'manager',
] as const;

export type AppUserRole = (typeof APP_USER_ROLES)[number];
export type HubRole = 'office' | 'advertising' | 'installer' | 'owner_admin';

export interface HubActor {
  readonly principalType: 'employee';
  readonly authUserId: string;
  readonly employeeId: string;
  readonly email: string;
  readonly active: true;
  readonly role: HubRole;
  readonly memberships: readonly Department[];
  readonly membershipVersion: number | null;
  readonly activeDepartmentContext: Department | null;
  readonly capabilities: readonly Capability[];
  readonly source: 'legacy_app_users';
}

const OFFICE_CAPABILITIES: readonly Capability[] = [
  'internal_public.read',
  'office.tools.use',
  'office.analytics.read',
  'office.calls.work',
  'office.customer.search',
  'office.coaching.self',
  'office.knowledge.read',
  'office.scoreboard.self',
  'office.second_mile.work',
  'office.second_mile.send',
];

// Deliberately enumerated instead of aliasing CAPABILITIES. Adding a future
// capability must never grant it to Owner/Admin without a policy review.
const OWNER_ADMIN_CAPABILITIES: readonly Capability[] = [
  'internal_public.read',
  'office.tools.use',
  'office.analytics.read',
  'office.calls.work',
  'office.customer.search',
  'office.coaching.self',
  'office.coaching.team.read',
  'office.coaching.settings.manage',
  'office.knowledge.read',
  'office.knowledge.manage',
  'office.pipeline.run',
  'office.scoreboard.self',
  'office.scoreboard.manage',
  'office.second_mile.work',
  'office.second_mile.send',
  'office.job_operations',
  'advertising.navigation',
  'installer.navigation',
  'operations.admin',
];

const ROLE_POLICY: Readonly<
  Record<Exclude<AppUserRole, 'manager'>, {
    role: HubRole;
    memberships: readonly Department[];
    capabilities: readonly Capability[];
  }>
> = {
  rep: {
    role: 'office',
    memberships: ['office'],
    capabilities: OFFICE_CAPABILITIES,
  },
  office: {
    role: 'office',
    memberships: ['office'],
    capabilities: OFFICE_CAPABILITIES,
  },
  advertising: {
    role: 'advertising',
    memberships: ['advertising'],
    capabilities: ['internal_public.read', 'advertising.navigation'],
  },
  installer: {
    role: 'installer',
    memberships: ['installer'],
    capabilities: ['internal_public.read', 'installer.navigation'],
  },
  owner: {
    role: 'owner_admin',
    memberships: DEPARTMENTS,
    capabilities: OWNER_ADMIN_CAPABILITIES,
  },
  admin: {
    role: 'owner_admin',
    memberships: DEPARTMENTS,
    capabilities: OWNER_ADMIN_CAPABILITIES,
  },
};

export function parseAppUserRole(value: unknown): AppUserRole | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return APP_USER_ROLES.find(role => role === normalized) ?? null;
}

export function buildLegacyActor(input: {
  authUserId: string;
  employeeId: string;
  email: string;
  appUserRole: AppUserRole;
}): HubActor | null {
  // Manager exists in the design vocabulary solely so negative tests can prove
  // that it is not provisioned in V1.
  if (input.appUserRole === 'manager') return null;

  const policy = ROLE_POLICY[input.appUserRole];
  return Object.freeze({
    principalType: 'employee',
    authUserId: input.authUserId,
    employeeId: input.employeeId,
    email: input.email.toLowerCase(),
    active: true,
    role: policy.role,
    memberships: Object.freeze([...policy.memberships]),
    membershipVersion: null,
    activeDepartmentContext: null,
    capabilities: Object.freeze([...policy.capabilities]),
    source: 'legacy_app_users',
  });
}

export function hasCapability(actor: HubActor, capability: Capability): boolean {
  return actor.capabilities.includes(capability);
}
