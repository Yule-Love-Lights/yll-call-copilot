import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const isSupabaseConfiguredMock = vi.fn();
let fakeClient: SupabaseClient;
vi.mock('@/lib/supabase', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/supabase')>('../../../lib/supabase');
  return {
    ...actual,
    isSupabaseConfigured: () => isSupabaseConfiguredMock(),
    getSupabaseServerClient: () => fakeClient,
  };
});

const getSessionEmailMock = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSessionEmail: (...args: unknown[]) => getSessionEmailMock(...args) }));

import { GET } from './route';

function fakeSupabase(rowsByRep: Record<string, { id: string; rep_email: string }[]>) {
  const eqCalls: [string, unknown][] = [];
  const builder = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    eq: (col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return builder;
    },
    then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
      const repFilter = eqCalls.find(([col]) => col === 'rep_email')?.[1] as string | undefined;
      resolve({ data: repFilter ? rowsByRep[repFilter] ?? [] : [], error: null });
    },
  };
  const from = vi.fn(() => builder);
  return { from } as unknown as SupabaseClient;
}

describe('GET /api/practice — signed-in rep\'s own recent sessions', () => {
  beforeEach(() => {
    isSupabaseConfiguredMock.mockReset().mockReturnValue(true);
    getSessionEmailMock.mockReset();
  });

  it('degrades when Supabase is not configured', async () => {
    isSupabaseConfiguredMock.mockReturnValue(false);
    const res = await GET();
    expect(await res.json()).toEqual({ configured: false, sessions: [] });
  });

  it('returns only the signed-in rep\'s own sessions', async () => {
    getSessionEmailMock.mockResolvedValue('me@yulelovelights.com');
    fakeClient = fakeSupabase({
      'me@yulelovelights.com': [{ id: 's1', rep_email: 'me@yulelovelights.com' }],
    });

    const res = await GET();
    const json = await res.json();

    expect(json.sessions).toHaveLength(1);
    expect(json.sessions[0].id).toBe('s1');
  });

  it('fails closed: no resolvable session email returns zero rows without querying', async () => {
    getSessionEmailMock.mockResolvedValue(null);
    fakeClient = fakeSupabase({});

    const res = await GET();
    const json = await res.json();

    expect(json.sessions).toEqual([]);
  });
});
