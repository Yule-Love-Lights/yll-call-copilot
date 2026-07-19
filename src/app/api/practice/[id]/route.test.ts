import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const isSupabaseConfiguredMock = vi.fn();
let fakeClient: SupabaseClient;
vi.mock('@/lib/supabase', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/supabase')>('../../../../lib/supabase');
  return {
    ...actual,
    isSupabaseConfigured: () => isSupabaseConfiguredMock(),
    getSupabaseServerClient: () => fakeClient,
  };
});

const getSessionEmailMock = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSessionEmail: (...args: unknown[]) => getSessionEmailMock(...args) }));

import { GET } from './route';
import type { PracticeSessionRow } from '@/lib/practice/types';

function params(id = 'sess-1') {
  return { params: Promise.resolve({ id }) };
}

function baseSession(overrides: Partial<PracticeSessionRow> = {}): PracticeSessionRow {
  return {
    id: 'sess-1',
    rep_email: 'rep@yulelovelights.com',
    vertical_slug: 'holiday',
    emotional_state: 'excited',
    objective: null,
    turns: [],
    status: 'active',
    score: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ended_at: null,
    ...overrides,
  };
}

function fakeSupabase(session: PracticeSessionRow | null, error: unknown = null) {
  const from = vi.fn((table: string) => {
    if (table !== 'practice_sessions') throw new Error(`Unexpected table in test: ${table}`);
    return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: session, error }) }) }) };
  });
  return { from } as unknown as SupabaseClient;
}

describe('GET /api/practice/[id] — owner-of-session only', () => {
  beforeEach(() => {
    isSupabaseConfiguredMock.mockReset().mockReturnValue(true);
    getSessionEmailMock.mockReset();
  });

  it('degrades when Supabase is not configured', async () => {
    isSupabaseConfiguredMock.mockReturnValue(false);
    const res = await GET(new Request('http://localhost/api/practice/sess-1'), params());
    expect(await res.json()).toEqual({ configured: false, session: null });
  });

  it('returns the session for its own rep', async () => {
    getSessionEmailMock.mockResolvedValue('rep@yulelovelights.com');
    fakeClient = fakeSupabase(baseSession());

    const res = await GET(new Request('http://localhost/api/practice/sess-1'), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.session.id).toBe('sess-1');
  });

  it('returns 404 (not 403) for a different rep, hiding that the session exists', async () => {
    getSessionEmailMock.mockResolvedValue('other@yulelovelights.com');
    fakeClient = fakeSupabase(baseSession({ rep_email: 'rep@yulelovelights.com' }));

    const res = await GET(new Request('http://localhost/api/practice/sess-1'), params());
    expect(res.status).toBe(404);
    expect((await res.json()).session).toBeNull();
  });

  it('fails closed (404) when no session email can be resolved at all', async () => {
    getSessionEmailMock.mockResolvedValue(null);
    fakeClient = fakeSupabase(baseSession());

    const res = await GET(new Request('http://localhost/api/practice/sess-1'), params());
    expect(res.status).toBe(404);
  });

  it('returns 404 when the session id does not exist', async () => {
    getSessionEmailMock.mockResolvedValue('rep@yulelovelights.com');
    fakeClient = fakeSupabase(null);

    const res = await GET(new Request('http://localhost/api/practice/missing'), params('missing'));
    expect(res.status).toBe(404);
  });

  it('degrades with a friendly reason when the table is missing', async () => {
    getSessionEmailMock.mockResolvedValue('rep@yulelovelights.com');
    fakeClient = fakeSupabase(null, { code: 'PGRST205', message: 'missing' });

    const res = await GET(new Request('http://localhost/api/practice/sess-1'), params());
    const json = await res.json();
    expect(json.migrated).toBe(false);
    expect(json.reason).toMatch(/migration 0016/);
  });
});
