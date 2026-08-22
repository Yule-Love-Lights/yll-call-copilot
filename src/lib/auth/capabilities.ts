export const DEPARTMENTS = ['office', 'advertising', 'installer'] as const;

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
  'office.tasks.work',
  'office.job_operations',
  'advertising.navigation',
  'installer.navigation',
  'operations.admin',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const OPS_EMPLOYEE_ROLES = [
  'office',
  'advertising',
  'installer',
  'owner',
  'admin',
  'manager',
] as const;

export type OpsEmployeeRole = (typeof OPS_EMPLOYEE_ROLES)[number];
export type HubRole = 'office' | 'advertising' | 'installer' | 'owner_admin';

export interface HubActor {
  readonly principalType: 'employee';
  readonly authUserId: string;
  readonly authIdentitySource: 'hub' | 'quote_tool';
  readonly employeeId: string;
  // Existing call/coaching facts still use an email attribution column. This
  // value comes from the UUID-linked employee row, never from auth metadata.
  readonly email: string;
  readonly active: true;
  readonly role: HubRole;
  readonly memberships: readonly Department[];
  readonly membershipVersion: number;
  readonly activeDepartmentContext: null;
  readonly capabilities: readonly Capability[];
  readonly source: 'ops_identity';
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
  'office.tasks.work',
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
  'office.tasks.work',
  'office.job_operations',
  'advertising.navigation',
  'installer.navigation',
  'operations.admin',
];

const ROLE_POLICY: Readonly<
  Record<Exclude<OpsEmployeeRole, 'manager'>, {
    role: HubRole;
    capabilities: readonly Capability[];
  }>
> = {
  office: {
    role: 'office',
    capabilities: OFFICE_CAPABILITIES,
  },
  advertising: {
    role: 'advertising',
    capabilities: ['internal_public.read', 'advertising.navigation'],
  },
  installer: {
    role: 'installer',
    capabilities: ['internal_public.read', 'installer.navigation'],
  },
  owner: {
    role: 'owner_admin',
    capabilities: OWNER_ADMIN_CAPABILITIES,
  },
  admin: {
    role: 'owner_admin',
    capabilities: OWNER_ADMIN_CAPABILITIES,
  },
};

const MEMBERSHIP_NAVIGATION_CAPABILITIES: Readonly<
  Record<Department, readonly Capability[]>
> = {
  office: [],
  advertising: ['advertising.navigation'],
  installer: ['installer.navigation'],
};

export function parseOpsEmployeeRole(value: unknown): OpsEmployeeRole | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return OPS_EMPLOYEE_ROLES.find(role => role === normalized) ?? null;
}

export function buildHubActor(input: {
  authUserId: string;
  authIdentitySource?: 'hub' | 'quote_tool';
  employeeId: string;
  compatibilityEmail: string;
  employeeRole: OpsEmployeeRole;
  memberships: readonly Department[];
  membershipVersion: number;
}): HubActor | null {
  // Manager exists in the design vocabulary solely so negative tests can prove
  // that it is not provisioned in V1.
  if (input.employeeRole === 'manager') return null;

  const policy = ROLE_POLICY[input.employeeRole];
  const memberships = DEPARTMENTS.filter(department =>
    input.memberships.includes(department),
  );
  const grantedCapabilities = new Set<Capability>(policy.capabilities);
  memberships.forEach(department => {
    MEMBERSHIP_NAVIGATION_CAPABILITIES[department].forEach(capability =>
      grantedCapabilities.add(capability),
    );
  });
  const capabilities = CAPABILITIES.filter(capability =>
    grantedCapabilities.has(capability),
  );
  return Object.freeze({
    principalType: 'employee',
    authUserId: input.authUserId,
    authIdentitySource: input.authIdentitySource ?? 'hub',
    employeeId: input.employeeId,
    email: input.compatibilityEmail.toLowerCase(),
    active: true,
    role: policy.role,
    memberships: Object.freeze(memberships),
    membershipVersion: input.membershipVersion,
    activeDepartmentContext: null,
    capabilities: Object.freeze(capabilities),
    source: 'ops_identity',
  });
}

export function hasCapability(actor: HubActor, capability: Capability): boolean {
  return actor.capabilities.includes(capability);
}
