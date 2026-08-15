import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkAllowlist, shouldDenyAccess } from './allowlist';

const AUTH_USER_ID = '123e4567-e89b-42d3-a456-426614174000';

function fakeClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn(async () => result);
  const eq = vi.fn();
  const query = { eq, maybeSingle };
  eq.mockReturnValue(query);
  const select = vi.fn(() => query);
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as SupabaseClient, from };
}

function activeIdentity() {
  return {
    id: '523e4567-e89b-42d3-a456-426614174000',
    employee_id: '423e4567-e89b-42d3-a456-426614174000',
    auth_user_id: AUTH_USER_ID,
    state: 'active',
    entity_version: 1,
    effective_at: '2026-01-01T00:00:00.000Z',
    revoked_at: null,
    employee: {
      id: '423e4567-e89b-42d3-a456-426614174000',
      compatibility_email: 'office@example.com',
      role: 'office',
      active: true,
      membership_version: 1,
      entity_version: 1,
      effective_at: '2026-01-01T00:00:00.000Z',
      deactivated_at: null,
      memberships: [{
        state: 'active',
        effective_at: '2026-01-01T00:00:00.000Z',
        revoked_at: null,
        membership_version: 1,
        department: { slug: 'office', active: true },
      }],
    },
  };
}

describe('checkAllowlist', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('allows only an actor resolved through an active auth link', async () => {
    const { client } = fakeClient({ data: activeIdentity(), error: null });
    await expect(checkAllowlist(AUTH_USER_ID, client)).resolves.toBe('allowed');
  });

  it('denies a missing or invalid actor', async () => {
    const missing = fakeClient({ data: null, error: null });
    await expect(checkAllowlist(AUTH_USER_ID, missing.client)).resolves.toBe('denied');
    await expect(checkAllowlist(null, missing.client)).resolves.toBe('denied');
    await expect(checkAllowlist('not-a-uuid', missing.client)).resolves.toBe('denied');
  });

  it('keeps identity dependency failure distinct and fail closed', async () => {
    const failed = fakeClient({ data: null, error: { message: 'boom' } });
    await expect(checkAllowlist(AUTH_USER_ID, failed.client)).resolves.toBe('unconfigured');
    await expect(checkAllowlist(AUTH_USER_ID, null)).resolves.toBe('unconfigured');
  });
});

describe('shouldDenyAccess', () => {
  it('denies explicit rejection and dependency unavailability', () => {
    expect(shouldDenyAccess('denied')).toBe(true);
    expect(shouldDenyAccess('unconfigured')).toBe(true);
    expect(shouldDenyAccess('allowed')).toBe(false);
  });
});
