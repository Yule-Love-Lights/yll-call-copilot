// Coverage for resolveStaffRole: the digest role gate's core policy. A
// missing app_users row, a missing email, an empty/blank role column, and a
// query error must all resolve to 'rep' (fail closed), never silently grant
// coach-level access. Style follows src/lib/auth/allowlist.test.ts -- mock
// the Supabase client, no live calls.

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveStaffRole } from './role';

function fakeClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn(async () => result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const client = { from } as unknown as SupabaseClient;
  return { client, from, select, eq };
}

describe('resolveStaffRole', () => {
  it('returns the row\'s role for a signed-in staff member', async () => {
    const { client } = fakeClient({ data: { role: 'owner' }, error: null });
    expect(await resolveStaffRole(client, 'naldo@yulelovelights.com')).toBe('owner');
  });

  it('returns "rep" when the row\'s role is literally "rep"', async () => {
    const { client } = fakeClient({ data: { role: 'rep' }, error: null });
    expect(await resolveStaffRole(client, 'rep@yulelovelights.com')).toBe('rep');
  });

  it('fails closed to "rep" when there is no app_users row', async () => {
    const { client } = fakeClient({ data: null, error: null });
    expect(await resolveStaffRole(client, 'stranger@yulelovelights.com')).toBe('rep');
  });

  it('fails closed to "rep" when the query errors', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'boom' } });
    expect(await resolveStaffRole(client, 'naldo@yulelovelights.com')).toBe('rep');
  });

  it('fails closed to "rep" when the email is null, without querying', async () => {
    const { client, from } = fakeClient({ data: { role: 'owner' }, error: null });
    expect(await resolveStaffRole(client, null)).toBe('rep');
    expect(from).not.toHaveBeenCalled();
  });

  it('fails closed to "rep" when the role column is blank or whitespace', async () => {
    const { client } = fakeClient({ data: { role: '   ' }, error: null });
    expect(await resolveStaffRole(client, 'naldo@yulelovelights.com')).toBe('rep');
  });

  it('fails closed to "rep" when the role column is missing entirely', async () => {
    const { client } = fakeClient({ data: {}, error: null });
    expect(await resolveStaffRole(client, 'naldo@yulelovelights.com')).toBe('rep');
  });

  it('queries app_users by a normalized email', async () => {
    const { client, eq } = fakeClient({ data: { role: 'admin' }, error: null });
    await resolveStaffRole(client, 'Naldo@YuleLoveLights.com');
    expect(eq).toHaveBeenCalledWith('email', 'naldo@yulelovelights.com');
  });

  it.each(['coach', 'manager', 'installer', 'advertising', 'manger', 'disabled'])(
    'never elevates non-legacy-admin role %j',
    async role => {
      const { client } = fakeClient({ data: { role }, error: null });
      expect(await resolveStaffRole(client, 'person@yulelovelights.com')).toBe('rep');
    },
  );

  it('maps the planned Office role to the least-privileged legacy rep behavior', async () => {
    const { client } = fakeClient({ data: { role: 'office' }, error: null });
    expect(await resolveStaffRole(client, 'person@yulelovelights.com')).toBe('rep');
  });
});
