// Coverage for the old route role projection over UUID-authorized employees.

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
    const { client } = fakeClient({ data: { role: 'owner', active: true }, error: null });
    expect(await resolveStaffRole(client, 'naldo@yulelovelights.com')).toBe('owner');
  });

  it('maps the canonical Office role to legacy "rep"', async () => {
    const { client } = fakeClient({ data: { role: 'office', active: true }, error: null });
    expect(await resolveStaffRole(client, 'rep@yulelovelights.com')).toBe('rep');
  });

  it('fails closed to "rep" when there is no employee row', async () => {
    const { client } = fakeClient({ data: null, error: null });
    expect(await resolveStaffRole(client, 'stranger@yulelovelights.com')).toBe('rep');
  });

  it('fails closed to "rep" when the query errors', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'boom' } });
    expect(await resolveStaffRole(client, 'naldo@yulelovelights.com')).toBe('rep');
  });

  it('fails closed to "rep" when the email is null, without querying', async () => {
    const { client, from } = fakeClient({ data: { role: 'owner', active: true }, error: null });
    expect(await resolveStaffRole(client, null)).toBe('rep');
    expect(from).not.toHaveBeenCalled();
  });

  it('fails closed to "rep" when the role column is blank or whitespace', async () => {
    const { client } = fakeClient({ data: { role: '   ', active: true }, error: null });
    expect(await resolveStaffRole(client, 'naldo@yulelovelights.com')).toBe('rep');
  });

  it('fails closed to "rep" when the role column is missing entirely', async () => {
    const { client } = fakeClient({ data: { active: true }, error: null });
    expect(await resolveStaffRole(client, 'naldo@yulelovelights.com')).toBe('rep');
  });

  it('queries ops_employees by a normalized compatibility email', async () => {
    const { client, from, select, eq } = fakeClient({ data: { role: 'admin', active: true }, error: null });
    await resolveStaffRole(client, 'Naldo@YuleLoveLights.com');
    expect(from).toHaveBeenCalledWith('ops_employees');
    expect(select).toHaveBeenCalledWith('role, active');
    expect(eq).toHaveBeenCalledWith('compatibility_email', 'naldo@yulelovelights.com');
  });

  it.each(['coach', 'manager', 'installer', 'advertising', 'manger', 'disabled'])(
    'never elevates non-legacy-admin role %j',
    async role => {
      const { client } = fakeClient({ data: { role, active: true }, error: null });
      expect(await resolveStaffRole(client, 'person@yulelovelights.com')).toBe('rep');
    },
  );

  it('never projects an inactive Owner/Admin as elevated', async () => {
    const { client } = fakeClient({ data: { role: 'owner', active: false }, error: null });
    expect(await resolveStaffRole(client, 'owner@yulelovelights.com')).toBe('rep');
  });
});
