// Coverage for the owner-facing role gate on POST /api/digest/generate
// (FIX 1): a rep hitting "Generate now" gets a 403 before the route ever
// calls runWeeklyDigest (which would hand back every rep's averages plus a
// named teammate's roughest moment), while an owner/admin generates as
// normal. Also covers FIX 3 (maxDuration raised to 120s). Mock style matches
// src/app/api/digest/route.test.ts; runWeeklyDigest itself is mocked since
// its own behavior is covered by src/lib/digest/generate.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const getSessionEmailMock = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getSessionEmail: (...args: unknown[]) => getSessionEmailMock(...args),
}));

const runWeeklyDigestMock = vi.fn();
vi.mock('@/lib/digest/runDigest', () => ({
  runWeeklyDigest: (...args: unknown[]) => runWeeklyDigestMock(...args),
}));

vi.mock('@/lib/claude', () => ({
  isClaudeConfigured: () => true,
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

import { POST, maxDuration } from './route';

function fakeSupabase(role: string | null) {
  const from = vi.fn((table: string) => {
    if (table === 'app_users') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: role ? { role } : null, error: null }) }) }) };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });
  return { from } as unknown as SupabaseClient;
}

function postRequest() {
  return new Request('http://localhost/api/digest/generate', { method: 'POST', body: JSON.stringify({}) });
}

describe('POST /api/digest/generate -- role gate', () => {
  beforeEach(() => {
    getSessionEmailMock.mockReset();
    runWeeklyDigestMock.mockReset();
  });

  it('403s a rep and never calls runWeeklyDigest', async () => {
    getSessionEmailMock.mockResolvedValue('rep@yulelovelights.com');
    fakeClient = fakeSupabase('rep');

    const res = await POST(postRequest());

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.reason).toBe("The weekly digest is for the coach's Friday review.");
    expect(runWeeklyDigestMock).not.toHaveBeenCalled();
  });

  it('lets an owner generate normally', async () => {
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    fakeClient = fakeSupabase('owner');
    runWeeklyDigestMock.mockResolvedValue({
      ok: true,
      alreadyExisted: false,
      digest: { id: '1', periodStart: '2026-07-06', periodEnd: '2026-07-12', content: {}, createdAt: '2026-07-12T00:00:00Z' },
    });

    const res = await POST(postRequest());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.generated).toBe(true);
    expect(runWeeklyDigestMock).toHaveBeenCalledTimes(1);
  });
});

describe('maxDuration (FIX 3)', () => {
  it('is raised to 120s so a slow single Claude call is not killed mid-generation', () => {
    expect(maxDuration).toBe(120);
  });
});
