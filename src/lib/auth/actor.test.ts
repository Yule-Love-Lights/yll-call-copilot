import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveHubActor } from './actor';

function fakeClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn(async () => result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return {
    client: { from } as unknown as SupabaseClient,
    from,
    select,
    eq,
  };
}

const sessionUser = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  email: 'Rep@YuleLoveLights.com',
};

describe('resolveHubActor', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('resolves a legacy rep into an immutable Office actor', async () => {
    const { client, from, select, eq } = fakeClient({
      data: { id: 'employee-1', role: 'rep' },
      error: null,
    });

    const result = await resolveHubActor(sessionUser, client);

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') throw new Error('expected a resolved actor');
    expect(result.actor).toMatchObject({
      principalType: 'employee',
      authUserId: '123e4567-e89b-42d3-a456-426614174000',
      employeeId: 'employee-1',
      email: 'rep@yulelovelights.com',
      active: true,
      role: 'office',
      memberships: ['office'],
      membershipVersion: null,
      activeDepartmentContext: null,
      source: 'legacy_app_users',
    });
    expect(result.actor.capabilities).toContain('office.tools.use');
    expect(result.actor.capabilities).not.toContain('office.coaching.settings.manage');
    expect(Object.isFrozen(result.actor.capabilities)).toBe(true);
    expect(Object.isFrozen(result.actor)).toBe(true);
    expect(from).toHaveBeenCalledWith('app_users');
    expect(select).toHaveBeenCalledWith('id, role');
    expect(eq).toHaveBeenCalledWith('email', 'rep@yulelovelights.com');
  });

  it.each(['owner', 'admin'])('grants the closed owner/admin capability set to %s', async role => {
    vi.stubEnv('HUB_OWNER_ADMIN_AUTH_USER_IDS', '123e4567-e89b-42d3-a456-426614174000,223e4567-e89b-42d3-a456-426614174000');
    const { client } = fakeClient({ data: { id: 'owner-id', role }, error: null });
    const result = await resolveHubActor(sessionUser, client);

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') throw new Error('expected a resolved actor');
    expect(result.actor.role).toBe('owner_admin');
    expect(result.actor.memberships).toEqual(['office', 'advertising', 'installer', 'management']);
    expect(result.actor.capabilities).toContain('operations.admin');
    expect(result.actor.capabilities).toContain('advertising.navigation');
    expect(result.actor.capabilities).toContain('installer.navigation');
  });

  it.each(['advertising', 'installer'] as const)('blocks %s provisioning until the field release gates pass', async role => {
    const { client } = fakeClient({ data: { id: `${role}-id`, role }, error: null });
    expect(await resolveHubActor(sessionUser, client)).toEqual({
      status: 'denied',
      reason: 'field_provisioning_blocked',
    });
  });

  it('fails closed for an unapproved Owner/Admin auth UUID', async () => {
    vi.stubEnv('HUB_OWNER_ADMIN_AUTH_USER_IDS', '223e4567-e89b-42d3-a456-426614174000,323e4567-e89b-42d3-a456-426614174000');
    const { client } = fakeClient({ data: { id: 'owner-id', role: 'owner' }, error: null });
    expect(await resolveHubActor(sessionUser, client)).toEqual({
      status: 'denied',
      reason: 'owner_admin_identity_not_approved',
    });
  });

  it('hard-denies the designed but unprovisioned Manager role', async () => {
    const { client } = fakeClient({ data: { id: 'manager-id', role: 'manager' }, error: null });
    expect(await resolveHubActor(sessionUser, client)).toEqual({
      status: 'denied',
      reason: 'manager_unprovisioned',
    });
  });

  it.each(['coach', 'manger', 'disabled', 'owner-ish', '', '   '])(
    'denies unknown role value %j instead of treating it as elevated',
    async role => {
      const { client } = fakeClient({ data: { id: 'employee-1', role }, error: null });
      expect(await resolveHubActor(sessionUser, client)).toEqual({
        status: 'denied',
        reason: 'unknown_role',
      });
    },
  );

  it('distinguishes missing staff from an unavailable authorization dependency', async () => {
    const missing = fakeClient({ data: null, error: null });
    expect(await resolveHubActor(sessionUser, missing.client)).toEqual({
      status: 'denied',
      reason: 'not_staff',
    });

    const failed = fakeClient({ data: null, error: { message: 'database unavailable' } });
    expect(await resolveHubActor(sessionUser, failed.client)).toEqual({
      status: 'unavailable',
    });
    expect(await resolveHubActor(sessionUser, null)).toEqual({ status: 'unavailable' });
  });

  it('denies malformed session and employee identities without granting a fallback actor', async () => {
    const validRow = fakeClient({ data: { id: 'employee-1', role: 'rep' }, error: null });
    expect(await resolveHubActor({ id: '', email: 'person@example.com' }, validRow.client)).toEqual({
      status: 'denied',
      reason: 'invalid_session_identity',
    });
    expect(validRow.from).not.toHaveBeenCalled();

    const invalidRow = fakeClient({ data: { id: '  ', role: 'rep' }, error: null });
    expect(await resolveHubActor(sessionUser, invalidRow.client)).toEqual({
      status: 'denied',
      reason: 'invalid_employee_identity',
    });
  });
});
