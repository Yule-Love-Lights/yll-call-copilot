import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveRepRole } from './role';

function fakeClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn(async () => result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as SupabaseClient, eq };
}

describe('resolveRepRole', () => {
  it.each([
    ['office', 'rep'],
    ['owner', 'owner'],
    ['admin', 'admin'],
  ] as const)('maps closed role %s to %s', async (stored, expected) => {
    const { client } = fakeClient({ data: { role: stored, active: true }, error: null });
    expect(await resolveRepRole('Person@Example.com', client)).toBe(expected);
  });

  it.each(['manager', 'advertising', 'installer', 'coach', 'manger', '']) (
    'returns null for non-Office or unknown role %j',
    async stored => {
      const { client } = fakeClient({ data: { role: stored, active: true }, error: null });
      expect(await resolveRepRole('person@example.com', client)).toBeNull();
    },
  );

  it('fails closed on missing identity, row, or query failure', async () => {
    const missing = fakeClient({ data: null, error: null });
    expect(await resolveRepRole(null, missing.client)).toBeNull();
    expect(await resolveRepRole('person@example.com', missing.client)).toBeNull();

    const failed = fakeClient({ data: null, error: { message: 'boom' } });
    expect(await resolveRepRole('person@example.com', failed.client)).toBeNull();
  });

  it('normalizes the lookup email', async () => {
    const { client, eq } = fakeClient({ data: { role: 'office', active: true }, error: null });
    await resolveRepRole('Person@Example.com', client);
    expect(eq).toHaveBeenCalledWith('compatibility_email', 'person@example.com');
  });

  it('fails closed for an inactive employee', async () => {
    const { client } = fakeClient({ data: { role: 'owner', active: false }, error: null });
    expect(await resolveRepRole('owner@example.com', client)).toBeNull();
  });
});
