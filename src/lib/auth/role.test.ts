// Coverage for the staff role resolver. Style follows allowlist.test.ts — we
// mock the Supabase client; no live Supabase calls.

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the stored role for a signed-in owner/admin', async () => {
    const { client } = fakeClient({ data: { role: 'owner' }, error: null });
    expect(await resolveStaffRole(client, 'boss@example.com')).toBe('owner');
  });

  it('returns "rep" when the app_users row has role "rep"', async () => {
    const { client } = fakeClient({ data: { role: 'rep' }, error: null });
    expect(await resolveStaffRole(client, 'rep@example.com')).toBe('rep');
  });

  it('fails closed to "rep" when there is no app_users row', async () => {
    const { client } = fakeClient({ data: null, error: null });
    expect(await resolveStaffRole(client, 'stranger@example.com')).toBe('rep');
  });

  it('fails closed to "rep" when the query errors', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'boom' } });
    expect(await resolveStaffRole(client, 'boss@example.com')).toBe('rep');
  });

  it('fails closed to "rep" when there is no email at all', async () => {
    const { client, from } = fakeClient({ data: { role: 'owner' }, error: null });
    expect(await resolveStaffRole(client, null)).toBe('rep');
    expect(from).not.toHaveBeenCalled();
  });

  it('fails closed to "rep" when the stored role is blank/whitespace', async () => {
    const { client } = fakeClient({ data: { role: '   ' }, error: null });
    expect(await resolveStaffRole(client, 'boss@example.com')).toBe('rep');
  });

  it('fails closed to "rep" when the stored role column is missing/undefined', async () => {
    const { client } = fakeClient({ data: {}, error: null });
    expect(await resolveStaffRole(client, 'boss@example.com')).toBe('rep');
  });
});
