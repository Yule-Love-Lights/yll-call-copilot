// Coverage for resolveStaffRole. Style follows allowlist.test.ts -- mock the
// Supabase client, no live calls. The important behavior is fail-closed:
// anything that isn't a clean, present, non-empty role resolves to 'rep'.

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveStaffRole } from './role';

function fakeClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn(async () => result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const client = { from } as unknown as SupabaseClient;
  return { client, from, eq };
}

describe('resolveStaffRole', () => {
  it('returns the stored role for a known email', async () => {
    const { client } = fakeClient({ data: { role: 'owner' }, error: null });
    expect(await resolveStaffRole(client, 'naldo@example.com')).toBe('owner');
  });

  it('defaults to rep when the role column is empty/whitespace', async () => {
    const { client } = fakeClient({ data: { role: '  ' }, error: null });
    expect(await resolveStaffRole(client, 'rep@example.com')).toBe('rep');
  });

  it('fails closed to rep when there is no app_users row', async () => {
    const { client } = fakeClient({ data: null, error: null });
    expect(await resolveStaffRole(client, 'stranger@example.com')).toBe('rep');
  });

  it('fails closed to rep when the query errors', async () => {
    const { client } = fakeClient({ data: { role: 'owner' }, error: { message: 'boom' } });
    expect(await resolveStaffRole(client, 'naldo@example.com')).toBe('rep');
  });

  it('fails closed to rep when there is no email (not signed in)', async () => {
    const { client, from } = fakeClient({ data: { role: 'owner' }, error: null });
    expect(await resolveStaffRole(client, null)).toBe('rep');
    expect(from).not.toHaveBeenCalled();
  });
});
