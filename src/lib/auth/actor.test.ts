import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveHubActor } from './actor';

const AUTH_USER_ID = '123e4567-e89b-42d3-a456-426614174000';
const SECOND_ADMIN_ID = '223e4567-e89b-42d3-a456-426614174000';
const OTHER_AUTH_ID = '323e4567-e89b-42d3-a456-426614174000';
const EMPLOYEE_ID = '423e4567-e89b-42d3-a456-426614174000';
const AUTH_IDENTITY_ID = '523e4567-e89b-42d3-a456-426614174000';

function activeMembership(
  slug: string = 'office',
  overrides: Record<string, unknown> = {},
) {
  return {
    state: 'active',
    effective_at: '2026-01-01T00:00:00.000Z',
    revoked_at: null,
    membership_version: 1,
    department: { slug, active: true },
    ...overrides,
  };
}

function authIdentity(
  employeeOverrides: Record<string, unknown> = {},
  identityOverrides: Record<string, unknown> = {},
) {
  return {
    id: AUTH_IDENTITY_ID,
    employee_id: EMPLOYEE_ID,
    auth_user_id: AUTH_USER_ID,
    state: 'active',
    entity_version: 1,
    effective_at: '2026-01-01T00:00:00.000Z',
    revoked_at: null,
    employee: {
      id: EMPLOYEE_ID,
      compatibility_email: 'Rep@YuleLoveLights.com',
      role: 'office',
      active: true,
      membership_version: 1,
      entity_version: 1,
      effective_at: '2026-01-01T00:00:00.000Z',
      deactivated_at: null,
      memberships: [activeMembership()],
      ...employeeOverrides,
    },
    ...identityOverrides,
  };
}

function fakeClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn(async () => result);
  const eq = vi.fn();
  const query = { eq, maybeSingle };
  eq.mockReturnValue(query);
  const select = vi.fn(() => query);
  const from = vi.fn(() => ({ select }));
  return {
    client: { from } as unknown as SupabaseClient,
    from,
    select,
    eq,
  };
}

describe('resolveHubActor', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('resolves a Quote Tool-authenticated user only through an active external employee identity', async () => {
    const { client, from, eq } = fakeClient({
      data: {
        ...authIdentity(),
        subject_user_id: AUTH_USER_ID,
        issuer: 'quote_tool',
      },
      error: null,
    });

    const result = await resolveHubActor({ id: AUTH_USER_ID, identitySource: 'quote_tool' }, client);

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') throw new Error('expected a resolved actor');
    expect(result.actor.authUserId).toBe(AUTH_USER_ID);
    expect(result.actor.authIdentitySource).toBe('quote_tool');
    expect(from).toHaveBeenCalledWith('ops_employee_external_identities');
    expect(eq).toHaveBeenCalledWith('issuer', 'quote_tool');
    expect(eq).toHaveBeenCalledWith('subject_user_id', AUTH_USER_ID);
    expect(eq).toHaveBeenCalledWith('state', 'active');
  });

  it('rejects an external identity whose issuer does not match the selected source', async () => {
    const { client } = fakeClient({
      data: {
        ...authIdentity(),
        subject_user_id: AUTH_USER_ID,
        issuer: 'hub',
      },
      error: null,
    });

    await expect(
      resolveHubActor({ id: AUTH_USER_ID, identitySource: 'quote_tool' }, client),
    ).resolves.toEqual({ status: 'denied', reason: 'invalid_employee_identity' });
  });

  it('resolves a phone-only session through its active versioned auth link', async () => {
    const { client, from, select, eq } = fakeClient({ data: authIdentity(), error: null });

    const result = await resolveHubActor({ id: AUTH_USER_ID }, client);

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') throw new Error('expected a resolved actor');
    expect(result.actor).toMatchObject({
      principalType: 'employee',
      authUserId: AUTH_USER_ID,
      authIdentitySource: 'hub',
      employeeId: EMPLOYEE_ID,
      email: 'rep@yulelovelights.com',
      active: true,
      role: 'office',
      memberships: ['office'],
      membershipVersion: 1,
      activeDepartmentContext: null,
      source: 'ops_identity',
    });
    expect(result.actor.capabilities).toContain('office.tools.use');
    expect(result.actor.capabilities).not.toContain('office.coaching.settings.manage');
    expect(Object.isFrozen(result.actor.memberships)).toBe(true);
    expect(Object.isFrozen(result.actor.capabilities)).toBe(true);
    expect(Object.isFrozen(result.actor)).toBe(true);
    expect(from).toHaveBeenCalledWith('ops_employee_auth_identities');
    expect(select).toHaveBeenCalledWith(
      expect.stringContaining('employee:ops_employees!inner'),
    );
    expect(eq).toHaveBeenCalledWith('auth_user_id', AUTH_USER_ID);
    expect(eq).toHaveBeenCalledWith('state', 'active');
  });

  it('ignores auth email metadata and returns the employee compatibility email', async () => {
    const { client } = fakeClient({ data: authIdentity(), error: null });
    const result = await resolveHubActor(
      { id: AUTH_USER_ID, email: 'spoofed-owner@example.com' },
      client,
    );

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') throw new Error('expected a resolved actor');
    expect(result.actor.email).toBe('rep@yulelovelights.com');
  });

  it('accepts an older active grant under a later employee membership snapshot', async () => {
    const { client } = fakeClient({
      data: authIdentity({ membership_version: 3 }),
      error: null,
    });
    const result = await resolveHubActor({ id: AUTH_USER_ID }, client);

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') throw new Error('expected a resolved actor');
    expect(result.actor.membershipVersion).toBe(3);
    expect(result.actor.memberships).toEqual(['office']);
  });

  it('adds Installer navigation, but no sensitive grants, to Office with an Installer membership', async () => {
    const { client } = fakeClient({
      data: authIdentity({
        memberships: [activeMembership('office'), activeMembership('installer')],
      }),
      error: null,
    });
    const result = await resolveHubActor({ id: AUTH_USER_ID }, client);

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') throw new Error('expected a resolved actor');
    expect(result.actor.memberships).toEqual(['office', 'installer']);
    expect(result.actor.capabilities).toContain('installer.navigation');
    expect(result.actor.capabilities).not.toContain('operations.admin');
    expect(result.actor.capabilities).not.toContain('office.coaching.team.read');
    expect(result.actor.capabilities).not.toContain('office.job_operations');
  });

  it('ignores revoked and future secondary memberships in a later membership snapshot', async () => {
    const { client } = fakeClient({
      data: authIdentity({
        membership_version: 3,
        memberships: [
          activeMembership('office'),
          activeMembership('installer', {
            state: 'revoked',
            revoked_at: '2026-02-01T00:00:00.000Z',
            membership_version: 2,
          }),
          activeMembership('advertising', {
            effective_at: '2999-01-01T00:00:00.000Z',
            membership_version: 3,
          }),
        ],
      }),
      error: null,
    });

    const result = await resolveHubActor({ id: AUTH_USER_ID }, client);

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') throw new Error('expected a resolved actor');
    expect(result.actor.membershipVersion).toBe(3);
    expect(result.actor.memberships).toEqual(['office']);
    expect(result.actor.capabilities).not.toContain('advertising.navigation');
    expect(result.actor.capabilities).not.toContain('installer.navigation');
  });

  it.each(['owner', 'admin'] as const)(
    'grants the closed Owner/Admin capability set to an approved %s identity',
    async role => {
      vi.stubEnv('HUB_OWNER_ADMIN_AUTH_USER_IDS', `${AUTH_USER_ID},${SECOND_ADMIN_ID}`);
      const { client } = fakeClient({
        data: authIdentity({
          role,
          memberships: [
            activeMembership('installer'),
            activeMembership('office'),
            activeMembership('advertising'),
          ],
        }),
        error: null,
      });
      const result = await resolveHubActor({ id: AUTH_USER_ID }, client);

      expect(result.status).toBe('resolved');
      if (result.status !== 'resolved') throw new Error('expected a resolved actor');
      expect(result.actor.role).toBe('owner_admin');
      expect(result.actor.memberships).toEqual(['office', 'advertising', 'installer']);
      expect(result.actor.capabilities).toContain('operations.admin');
    },
  );

  it('uses the selected Quote Tool Auth UUID, not a Hub UUID, for the Owner/Admin ceiling', async () => {
    vi.stubEnv('HUB_OWNER_ADMIN_AUTH_USER_IDS', `${AUTH_USER_ID},${SECOND_ADMIN_ID}`);
    const { client } = fakeClient({
      data: {
        ...authIdentity({
          role: 'owner',
          memberships: [activeMembership('office')],
        }),
        subject_user_id: AUTH_USER_ID,
        issuer: 'quote_tool',
      },
      error: null,
    });

    const result = await resolveHubActor(
      { id: AUTH_USER_ID, identitySource: 'quote_tool' },
      client,
    );

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') throw new Error('expected a resolved actor');
    expect(result.actor.authIdentitySource).toBe('quote_tool');
    expect(result.actor.role).toBe('owner_admin');
  });

  it('enforces the exact two-person Owner/Admin UUID ceiling', async () => {
    const { client } = fakeClient({ data: authIdentity({ role: 'owner' }), error: null });

    for (const ceiling of [
      '',
      AUTH_USER_ID,
      `${AUTH_USER_ID},${AUTH_USER_ID}`,
      `${SECOND_ADMIN_ID},${OTHER_AUTH_ID}`,
      `${AUTH_USER_ID},not-a-uuid`,
      `${AUTH_USER_ID},${SECOND_ADMIN_ID},not-a-uuid`,
      `${AUTH_USER_ID},${SECOND_ADMIN_ID},${OTHER_AUTH_ID}`,
    ]) {
      vi.stubEnv('HUB_OWNER_ADMIN_AUTH_USER_IDS', ceiling);
      await expect(resolveHubActor({ id: AUTH_USER_ID }, client)).resolves.toEqual({
        status: 'denied',
        reason: 'owner_admin_identity_not_approved',
      });
    }
  });

  it.each(['advertising', 'installer'] as const)(
    'blocks %s provisioning even with a valid linked membership',
    async role => {
      const { client } = fakeClient({
        data: authIdentity({ role, memberships: [activeMembership(role)] }),
        error: null,
      });
      await expect(resolveHubActor({ id: AUTH_USER_ID }, client)).resolves.toEqual({
        status: 'denied',
        reason: 'field_provisioning_blocked',
      });
    },
  );

  it.each([
    ['advertising', 'installer'],
    ['installer', 'advertising'],
  ] as const)(
    'denies %s before the field gate when its active membership is only %s',
    async (role, membership) => {
      const { client } = fakeClient({
        data: authIdentity({ role, memberships: [activeMembership(membership)] }),
        error: null,
      });
      await expect(resolveHubActor({ id: AUTH_USER_ID }, client)).resolves.toEqual({
        status: 'denied',
        reason: 'no_active_memberships',
      });
    },
  );

  it.each(['advertising', 'installer'] as const)(
    'returns the intentional field gate for phone-only %s rows without a compatibility email',
    async role => {
      const { client } = fakeClient({
        data: authIdentity({
          role,
          compatibility_email: null,
          memberships: [activeMembership(role)],
        }),
        error: null,
      });
      await expect(resolveHubActor({ id: AUTH_USER_ID }, client)).resolves.toEqual({
        status: 'denied',
        reason: 'field_provisioning_blocked',
      });
    },
  );

  it('hard-denies the designed but unprovisioned Manager role', async () => {
    const { client } = fakeClient({ data: authIdentity({ role: 'manager' }), error: null });
    await expect(resolveHubActor({ id: AUTH_USER_ID }, client)).resolves.toEqual({
      status: 'denied',
      reason: 'manager_unprovisioned',
    });
  });

  it('denies inactive and unlinked employees', async () => {
    const inactive = fakeClient({ data: authIdentity({ active: false }), error: null });
    await expect(resolveHubActor({ id: AUTH_USER_ID }, inactive.client)).resolves.toEqual({
      status: 'denied',
      reason: 'employee_inactive',
    });

    const unlinked = fakeClient({ data: null, error: null });
    await expect(resolveHubActor({ id: AUTH_USER_ID }, unlinked.client)).resolves.toEqual({
      status: 'denied',
      reason: 'not_staff',
    });
  });

  it.each([
    { effective_at: '2999-01-01T00:00:00.000Z' },
    { deactivated_at: '2026-02-01T00:00:00.000Z' },
  ])('denies an employee whose active state is not currently effective: %#', async override => {
    const { client } = fakeClient({ data: authIdentity(override), error: null });
    await expect(resolveHubActor({ id: AUTH_USER_ID }, client)).resolves.toEqual({
      status: 'denied',
      reason: 'employee_inactive',
    });
  });

  it.each([
    { entity_version: 0 },
    { entity_version: '1' },
    { effective_at: 'not-a-timestamp' },
  ])('denies malformed employee version or effective time: %#', async override => {
    const { client } = fakeClient({ data: authIdentity(override), error: null });
    await expect(resolveHubActor({ id: AUTH_USER_ID }, client)).resolves.toEqual({
      status: 'denied',
      reason: 'invalid_employee_identity',
    });
  });

  it('treats a revoked auth link as unlinked staff', async () => {
    const revoked = fakeClient({
      data: authIdentity({}, {
        state: 'revoked',
        entity_version: 2,
        revoked_at: '2026-02-01T00:00:00.000Z',
      }),
      error: null,
    });
    await expect(resolveHubActor({ id: AUTH_USER_ID }, revoked.client)).resolves.toEqual({
      status: 'denied',
      reason: 'not_staff',
    });
  });

  it('allows a rotated active auth UUID to resolve the same stable employee ID', async () => {
    const rotated = fakeClient({
      data: authIdentity({}, {
        auth_user_id: OTHER_AUTH_ID,
        entity_version: 3,
      }),
      error: null,
    });
    const result = await resolveHubActor({ id: OTHER_AUTH_ID }, rotated.client);

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') throw new Error('expected a resolved actor');
    expect(result.actor.authUserId).toBe(OTHER_AUTH_ID);
    expect(result.actor.employeeId).toBe(EMPLOYEE_ID);
  });

  it('denies malformed or mismatched immutable identities', async () => {
    const valid = fakeClient({ data: authIdentity(), error: null });
    await expect(resolveHubActor({ id: 'not-a-uuid' }, valid.client)).resolves.toEqual({
      status: 'denied',
      reason: 'invalid_session_identity',
    });
    expect(valid.from).not.toHaveBeenCalled();

    const mismatched = fakeClient({
      data: authIdentity({}, { auth_user_id: OTHER_AUTH_ID }),
      error: null,
    });
    await expect(resolveHubActor({ id: AUTH_USER_ID }, mismatched.client)).resolves.toEqual({
      status: 'denied',
      reason: 'invalid_employee_identity',
    });

    const wrongEmployee = fakeClient({
      data: authIdentity({ id: OTHER_AUTH_ID }),
      error: null,
    });
    await expect(resolveHubActor({ id: AUTH_USER_ID }, wrongEmployee.client)).resolves.toEqual({
      status: 'denied',
      reason: 'invalid_employee_identity',
    });
  });

  it.each([
    { entity_version: 0 },
    { effective_at: 'not-a-timestamp' },
    { effective_at: '2999-01-01T00:00:00.000Z' },
    { employee: null },
  ])('denies malformed active auth link %#', async identityOverride => {
    const { client } = fakeClient({
      data: authIdentity({}, identityOverride),
      error: null,
    });
    await expect(resolveHubActor({ id: AUTH_USER_ID }, client)).resolves.toEqual({
      status: 'denied',
      reason: 'invalid_employee_identity',
    });
  });

  it('requires a compatibility email while legacy attribution columns remain', async () => {
    const { client } = fakeClient({
      data: authIdentity({ compatibility_email: null }),
      error: null,
    });
    await expect(resolveHubActor({ id: AUTH_USER_ID }, client)).resolves.toEqual({
      status: 'denied',
      reason: 'compatibility_email_missing',
    });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, '1'])(
    'denies invalid employee membership version %j',
    async membershipVersion => {
      const { client } = fakeClient({
        data: authIdentity({ membership_version: membershipVersion }),
        error: null,
      });
      await expect(resolveHubActor({ id: AUTH_USER_ID }, client)).resolves.toEqual({
        status: 'denied',
        reason: 'invalid_membership_version',
      });
    },
  );

  it.each([
    { memberships: null },
    { memberships: [activeMembership('management')] },
    {
      memberships: [activeMembership(), activeMembership()],
    },
    {
      memberships: [activeMembership('office', { revoked_at: '2026-02-01T00:00:00.000Z' })],
    },
    {
      memberships: [activeMembership('office', { department: { slug: 'office' } })],
    },
    {
      memberships: [activeMembership('office', { membership_version: 2 })],
    },
  ])('denies an invalid membership snapshot %#', async override => {
    const { client } = fakeClient({ data: authIdentity(override), error: null });
    await expect(resolveHubActor({ id: AUTH_USER_ID }, client)).resolves.toEqual({
      status: 'denied',
      reason: 'invalid_membership_snapshot',
    });
  });

  it('requires at least one current membership and the role membership', async () => {
    const revoked = fakeClient({
      data: authIdentity({
        memberships: [
          activeMembership('office', {
            state: 'revoked',
            revoked_at: '2026-02-01T00:00:00.000Z',
          }),
        ],
      }),
      error: null,
    });
    await expect(resolveHubActor({ id: AUTH_USER_ID }, revoked.client)).resolves.toEqual({
      status: 'denied',
      reason: 'no_active_memberships',
    });

    const wrongDepartment = fakeClient({
      data: authIdentity({ memberships: [activeMembership('installer')] }),
      error: null,
    });
    await expect(resolveHubActor({ id: AUTH_USER_ID }, wrongDepartment.client)).resolves.toEqual({
      status: 'denied',
      reason: 'no_active_memberships',
    });
  });

  it.each(['coach', 'manger', 'disabled', 'owner-ish', '', '   '])(
    'denies unknown role value %j',
    async role => {
      const { client } = fakeClient({ data: authIdentity({ role }), error: null });
      await expect(resolveHubActor({ id: AUTH_USER_ID }, client)).resolves.toEqual({
        status: 'denied',
        reason: 'unknown_role',
      });
    },
  );

  it('distinguishes missing staff from an unavailable identity dependency', async () => {
    const failed = fakeClient({ data: null, error: { message: 'database unavailable' } });
    await expect(resolveHubActor({ id: AUTH_USER_ID }, failed.client)).resolves.toEqual({
      status: 'unavailable',
    });
    await expect(resolveHubActor({ id: AUTH_USER_ID }, null)).resolves.toEqual({
      status: 'unavailable',
    });
  });
});
