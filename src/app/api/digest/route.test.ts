// Coverage for the owner-facing role gate on GET /api/digest (FIX 1): a rep
// gets a 403 instead of every rep's averages plus a named teammate's
// roughest moment, while an owner/admin gets the normal digest list. Mocks
// @/lib/auth/session (who's signed in) and @/lib/supabase (config + the
// service-role client), same fake-Supabase-client style as
// src/lib/auth/allowlist.test.ts / src/lib/leads/queue.test.ts. Exercises
// the real resolveStaffRole (src/lib/auth/role.ts) against a fake ops_employees
// row rather than mocking it, so the gate is tested end to end.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const getSessionEmailMock = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getSessionEmail: (...args: unknown[]) => getSessionEmailMock(...args),
}));

let fakeClient: SupabaseClient;
vi.mock('@/lib/supabase', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase')>('@/lib/supabase');
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    getSupabaseServerClient: () => fakeClient,
  };
});

import { GET } from './route';

function fakeSupabase(role: string | null, digestRows: Record<string, unknown>[] = []) {
  const from = vi.fn((table: string) => {
    if (table === 'ops_employees') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: role ? { role, active: true } : null, error: null }) }) }) };
    }
    if (table === 'weekly_digests') {
      return { select: () => ({ order: () => ({ limit: async () => ({ data: digestRows, error: null }) }) }) };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });
  return { from } as unknown as SupabaseClient;
}

describe('GET /api/digest -- role gate', () => {
  beforeEach(() => {
    getSessionEmailMock.mockReset();
  });

  it('403s a rep instead of returning the team digest', async () => {
    getSessionEmailMock.mockResolvedValue('rep@yulelovelights.com');
    fakeClient = fakeSupabase('office');

    const res = await GET();

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("The weekly digest is for the coach's Friday review.");
  });

  it('403s (fail closed) when the caller has no ops_employees row', async () => {
    getSessionEmailMock.mockResolvedValue('stranger@yulelovelights.com');
    fakeClient = fakeSupabase(null);

    const res = await GET();

    expect(res.status).toBe(403);
  });

  it('lets an owner through to the real digest list', async () => {
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    fakeClient = fakeSupabase('owner', [
      { id: '1', period_start: '2026-07-06', period_end: '2026-07-12', content: { stats: {} }, created_at: '2026-07-12T00:00:00Z' },
    ]);

    const res = await GET();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.digests).toHaveLength(1);
    expect(json.digests[0].id).toBe('1');
  });
});
