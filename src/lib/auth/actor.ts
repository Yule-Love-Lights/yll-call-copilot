import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '@/lib/supabase';
import type { HubAuthIdentitySource } from './config';
import {
  DEPARTMENTS,
  buildHubActor,
  parseOpsEmployeeRole,
  type Department,
  type HubActor,
} from './capabilities';

export interface AuthenticatedUserIdentity {
  readonly id?: unknown;
  readonly email?: unknown;
  readonly identitySource?: unknown;
}

export type ActorResolution =
  | { readonly status: 'resolved'; readonly actor: HubActor }
  | {
      readonly status: 'denied';
      readonly reason:
        | 'invalid_session_identity'
        | 'not_staff'
        | 'employee_inactive'
        | 'invalid_employee_identity'
        | 'compatibility_email_missing'
        | 'unknown_role'
        | 'invalid_membership_version'
        | 'invalid_membership_snapshot'
        | 'no_active_memberships'
        | 'manager_unprovisioned'
        | 'field_provisioning_blocked'
        | 'owner_admin_identity_not_approved';
    }
  | { readonly status: 'unavailable' };

interface EmployeeAuthIdentityRow {
  id?: unknown;
  employee_id?: unknown;
  auth_user_id?: unknown;
  state?: unknown;
  entity_version?: unknown;
  effective_at?: unknown;
  revoked_at?: unknown;
  employee?: unknown;
}

interface EmployeeExternalIdentityRow {
  id?: unknown;
  employee_id?: unknown;
  issuer?: unknown;
  subject_user_id?: unknown;
  state?: unknown;
  entity_version?: unknown;
  effective_at?: unknown;
  revoked_at?: unknown;
  employee?: unknown;
}

interface OpsEmployeeRow {
  id?: unknown;
  compatibility_email?: unknown;
  role?: unknown;
  active?: unknown;
  membership_version?: unknown;
  entity_version?: unknown;
  effective_at?: unknown;
  deactivated_at?: unknown;
  memberships?: unknown;
}

interface MembershipRow {
  state?: unknown;
  effective_at?: unknown;
  revoked_at?: unknown;
  membership_version?: unknown;
  department?: unknown;
}

interface DepartmentRow {
  slug?: unknown;
  active?: unknown;
}

const EMPLOYEE_AUTH_IDENTITY_SELECT = `
  id,
  employee_id,
  auth_user_id,
  state,
  entity_version,
  effective_at,
  revoked_at,
  employee:ops_employees!inner (
    id,
    compatibility_email,
    role,
    active,
    membership_version,
    entity_version,
    effective_at,
    deactivated_at,
    memberships:ops_employee_department_memberships (
      state,
      effective_at,
      revoked_at,
      membership_version,
      department:ops_departments (
        slug,
        active
      )
    )
  )
`;

const EMPLOYEE_EXTERNAL_IDENTITY_SELECT = `
  id,
  employee_id,
  issuer,
  subject_user_id,
  state,
  entity_version,
  effective_at,
  revoked_at,
  employee:ops_employees!inner (
    id,
    compatibility_email,
    role,
    active,
    membership_version,
    entity_version,
    effective_at,
    deactivated_at,
    memberships:ops_employee_department_memberships (
      state,
      effective_at,
      revoked_at,
      membership_version,
      department:ops_departments (
        slug,
        active
      )
    )
  )
`;

// Resolves the one immutable Hub-local actor used by request authorization.
// Supabase auth email/phone metadata is deliberately ignored. The auth UUID
// resolves through one active, versioned link to the stable employee identity.
export async function resolveHubActor(
  user: AuthenticatedUserIdentity,
  client: SupabaseClient | null = getSupabaseServerClient(),
): Promise<ActorResolution> {
  const authUserId = normalizedUuid(user.id);
  const identitySource = parseIdentitySource(user.identitySource);
  if (!authUserId || !identitySource) {
    return { status: 'denied', reason: 'invalid_session_identity' };
  }
  if (!client) return { status: 'unavailable' };

  const { data, error } = identitySource === 'hub'
    ? await client
      .from('ops_employee_auth_identities')
      .select(EMPLOYEE_AUTH_IDENTITY_SELECT)
      .eq('auth_user_id', authUserId)
      .eq('state', 'active')
      .maybeSingle()
    : await client
      .from('ops_employee_external_identities')
      .select(EMPLOYEE_EXTERNAL_IDENTITY_SELECT)
      .eq('issuer', 'quote_tool')
      .eq('subject_user_id', authUserId)
      .eq('state', 'active')
      .maybeSingle();

  if (error) return { status: 'unavailable' };
  if (!data) return { status: 'denied', reason: 'not_staff' };

  const identity = data as EmployeeAuthIdentityRow | EmployeeExternalIdentityRow;
  const identityId = normalizedUuid(identity.id);
  const employeeId = normalizedUuid(identity.employee_id);
  const linkedAuthUserId = identitySource === 'hub'
    ? normalizedUuid((identity as EmployeeAuthIdentityRow).auth_user_id)
    : normalizedUuid((identity as EmployeeExternalIdentityRow).subject_user_id);
  const identityVersion = positiveSafeInteger(identity.entity_version);
  const identityEffectiveAt = normalizedTimestamp(identity.effective_at);
  if (
    identity.state !== 'active' ||
    identity.revoked_at !== null
  ) {
    return { status: 'denied', reason: 'not_staff' };
  }
  if (
    !identityId ||
    !employeeId ||
    linkedAuthUserId !== authUserId ||
    !identityVersion ||
    !identityEffectiveAt ||
    identityEffectiveAt.getTime() > Date.now() ||
    !isRecord(identity.employee)
  ) {
    return { status: 'denied', reason: 'invalid_employee_identity' };
  }
  if (
    identitySource === 'quote_tool'
    && (identity as EmployeeExternalIdentityRow).issuer !== 'quote_tool'
  ) {
    return { status: 'denied', reason: 'invalid_employee_identity' };
  }

  const row = identity.employee as OpsEmployeeRow;
  const employeeVersion = positiveSafeInteger(row.entity_version);
  const employeeEffectiveAt = normalizedTimestamp(row.effective_at);
  if (!employeeVersion || !employeeEffectiveAt) {
    return { status: 'denied', reason: 'invalid_employee_identity' };
  }
  if (row.active !== true) {
    return { status: 'denied', reason: 'employee_inactive' };
  }
  if (
    employeeEffectiveAt.getTime() > Date.now() ||
    row.deactivated_at !== null
  ) {
    return { status: 'denied', reason: 'employee_inactive' };
  }

  if (normalizedUuid(row.id) !== employeeId) {
    return { status: 'denied', reason: 'invalid_employee_identity' };
  }

  const role = parseOpsEmployeeRole(row.role);
  if (!role) return { status: 'denied', reason: 'unknown_role' };
  if (role === 'manager') {
    return { status: 'denied', reason: 'manager_unprovisioned' };
  }

  const membershipVersion = positiveSafeInteger(row.membership_version);
  if (!membershipVersion) {
    return { status: 'denied', reason: 'invalid_membership_version' };
  }

  const membershipResolution = resolveCurrentMemberships(
    row.memberships,
    membershipVersion,
  );
  if (membershipResolution.status === 'invalid') {
    return { status: 'denied', reason: 'invalid_membership_snapshot' };
  }
  if (membershipResolution.memberships.length === 0) {
    return { status: 'denied', reason: 'no_active_memberships' };
  }
  if (
    (role === 'office' || role === 'advertising' || role === 'installer') &&
    !membershipResolution.memberships.includes(role)
  ) {
    return { status: 'denied', reason: 'no_active_memberships' };
  }
  // Field accounts remain a hard release stop until OTP, immutable identity
  // linkage, paid-context projection, RLS, and resource tests all pass.
  if (role === 'advertising' || role === 'installer') {
    return { status: 'denied', reason: 'field_provisioning_blocked' };
  }
  if ((role === 'owner' || role === 'admin') && !isApprovedOwnerAdmin(authUserId)) {
    return { status: 'denied', reason: 'owner_admin_identity_not_approved' };
  }

  const compatibilityEmail = normalizedEmail(row.compatibility_email);
  if (!compatibilityEmail) {
    return { status: 'denied', reason: 'compatibility_email_missing' };
  }

  const actor = buildHubActor({
    authUserId,
    authIdentitySource: identitySource,
    employeeId,
    compatibilityEmail,
    employeeRole: role,
    memberships: membershipResolution.memberships,
    membershipVersion,
  });
  if (!actor) return { status: 'denied', reason: 'manager_unprovisioned' };
  return { status: 'resolved', actor };
}

function parseIdentitySource(value: unknown): HubAuthIdentitySource | null {
  if (value === undefined) return 'hub';
  return value === 'hub' || value === 'quote_tool' ? value : null;
}

function resolveCurrentMemberships(
  value: unknown,
  employeeMembershipVersion: number,
):
  | { readonly status: 'valid'; readonly memberships: readonly Department[] }
  | { readonly status: 'invalid' } {
  if (!Array.isArray(value)) return { status: 'invalid' };

  const current = new Set<Department>();
  for (const rawMembership of value) {
    if (!isRecord(rawMembership)) return { status: 'invalid' };
    const membership = rawMembership as MembershipRow;
    const membershipVersion = positiveSafeInteger(membership.membership_version);
    const effectiveAt = normalizedTimestamp(membership.effective_at);
    const state = normalizedNonEmptyString(membership.state)?.toLowerCase();
    const department = parseDepartmentRow(membership.department);

    if (
      !membershipVersion ||
      membershipVersion > employeeMembershipVersion ||
      !effectiveAt ||
      !department ||
      (state !== 'active' && state !== 'revoked')
    ) {
      return { status: 'invalid' };
    }

    if (state === 'revoked') {
      const revokedAt = normalizedTimestamp(membership.revoked_at);
      if (!revokedAt || revokedAt.getTime() < effectiveAt.getTime()) {
        return { status: 'invalid' };
      }
      continue;
    }

    if (membership.revoked_at !== null || effectiveAt.getTime() > Date.now()) {
      if (membership.revoked_at !== null) return { status: 'invalid' };
      continue;
    }
    if (department.active !== true) continue;
    if (current.has(department.slug)) return { status: 'invalid' };
    current.add(department.slug);
  }

  return {
    status: 'valid',
    memberships: DEPARTMENTS.filter(department => current.has(department)),
  };
}

function parseDepartmentRow(value: unknown): { slug: Department; active: boolean } | null {
  if (!isRecord(value)) return null;
  const raw = value as DepartmentRow;
  const slug = normalizedNonEmptyString(raw.slug)?.toLowerCase();
  if (!slug || !(DEPARTMENTS as readonly string[]).includes(slug)) return null;
  if (typeof raw.active !== 'boolean') return null;
  return { slug: slug as Department, active: raw.active };
}

function isApprovedOwnerAdmin(authUserId: string): boolean {
  const configuredIds = (process.env.HUB_OWNER_ADMIN_AUTH_USER_IDS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const approvedIds = configuredIds.map(value => normalizedUuid(value));
  return (
    approvedIds.length === 2 &&
    approvedIds.every((value): value is string => value !== null) &&
    new Set(approvedIds).size === 2 &&
    approvedIds.includes(authUserId)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizedUuid(value: unknown): string | null {
  const normalized = normalizedNonEmptyString(value)?.toLowerCase();
  if (!normalized) return null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  return uuid.test(normalized) ? normalized : null;
}

function normalizedEmail(value: unknown): string | null {
  const normalized = normalizedNonEmptyString(value);
  if (!normalized || !normalized.includes('@')) return null;
  return normalized.toLowerCase();
}

function positiveSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
    ? value
    : null;
}

function normalizedTimestamp(value: unknown): Date | null {
  const normalized = normalizedNonEmptyString(value);
  if (!normalized) return null;
  const timestamp = new Date(normalized);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}
