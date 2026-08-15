// Coverage for the owner-facing role gate on GET /api/digest/[id] (FIX 1):
// a rep gets a 403 for a specific past digest too, not just the list --
// same reasoning as GET /api/digest (a past digest still names a rep's
// roughest moment verbatim). Mock style matches
// src/app/api/digest/route.test.ts.

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

function fakeSupabase(role: string | null, digestRow: Record<string, unknown> | null = null) {
  const from = vi.fn((table: string) => {
    if (table === 'ops_employees') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: role ? { role, active: true } : null, error: null }) }) }) };
    }
    if (table === 'weekly_digests') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: digestRow, error: null }) }) }) };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });
  return { from } as unknown as SupabaseClient;
}

function fakeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/digest/[id] -- role gate', () => {
  beforeEach(() => {
    getSessionEmailMock.mockReset();
  });

  it('403s a rep instead of returning a past digest', async () => {
    getSessionEmailMock.mockResolvedValue('rep@yulelovelights.com');
    fakeClient = fakeSupabase('office');

    const res = await GET(new Request('http://localhost/api/digest/d1'), fakeParams('d1'));

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("The weekly digest is for the coach's Friday review.");
  });

  it('lets an owner through to the requested digest', async () => {
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    fakeClient = fakeSupabase('owner', {
      id: 'd1',
      period_start: '2026-07-06',
      period_end: '2026-07-12',
      content: { stats: {} },
      created_at: '2026-07-12T00:00:00Z',
    });

    const res = await GET(new Request('http://localhost/api/digest/d1'), fakeParams('d1'));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.digest.id).toBe('d1');
  });
});
