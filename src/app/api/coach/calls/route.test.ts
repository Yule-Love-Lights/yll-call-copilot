// Coverage for the owner-facing role gate on GET /api/coach/calls: a rep
// gets a 403 and the route never touches call_scores/transcripts (a rep
// must not be able to page through every rep's scored calls), while a
// non-rep gets the newest-first list built from the two queries. Mock
// style matches src/app/api/digest/route.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const getSessionEmailMock = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getSessionEmail: (...args: unknown[]) => getSessionEmailMock(...args),
}));

let fakeClient: SupabaseClient;
let fromMock: ReturnType<typeof vi.fn>;
vi.mock('@/lib/supabase', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase')>('@/lib/supabase');
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    getSupabaseServerClient: () => fakeClient,
  };
});

import { GET } from './route';

// A thenable query-builder stub: `.or()` returns the same object (so a
// caller can chain it or not) and `await`-ing it resolves to {data, error},
// matching how the real supabase-js builder behaves at every step. `.or()`
// also records the filter string it was called with, so the pair-cursor
// tests can assert on it without reaching into supabase-js internals.
let lastOrFilter: string | undefined;

function scoresQueryResult(data: unknown, error: unknown) {
  const builder: { or: (filter: string) => typeof builder; then: (resolve: (v: { data: unknown; error: unknown }) => unknown) => unknown } = {
    or: (filter: string) => {
      lastOrFilter = filter;
      return builder;
    },
    then: resolve => Promise.resolve({ data, error }).then(resolve),
  };
  return builder;
}

function fakeSupabase(role: string | null, scoreRows: Record<string, unknown>[] = [], transcriptRows: Record<string, unknown>[] = []) {
  fromMock = vi.fn((table: string) => {
    if (table === 'ops_employees') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: role ? { role, active: true } : null, error: null }) }) }) };
    }
    if (table === 'call_scores') {
      return { select: () => ({ eq: () => ({ order: () => ({ order: () => ({ limit: () => scoresQueryResult(scoreRows, null) }) }) }) }) };
    }
    if (table === 'transcripts') {
      return { select: () => ({ eq: () => ({ in: async () => ({ data: transcriptRows, error: null }) }) }) };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });
  return { from: fromMock } as unknown as SupabaseClient;
}

describe('GET /api/coach/calls -- role gate', () => {
  beforeEach(() => {
    getSessionEmailMock.mockReset();
    lastOrFilter = undefined;
  });

  it('403s a rep and never queries call_scores or transcripts', async () => {
    getSessionEmailMock.mockResolvedValue('rep@yulelovelights.com');
    fakeClient = fakeSupabase('office');

    const res = await GET(new Request('http://localhost/api/coach/calls'));

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Call review is for the coach's one-on-one prep, not a rep-facing page.");
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith('ops_employees');
  });

  it('403s (fail closed) when the caller has no ops_employees row', async () => {
    getSessionEmailMock.mockResolvedValue('stranger@yulelovelights.com');
    fakeClient = fakeSupabase(null);

    const res = await GET(new Request('http://localhost/api/coach/calls'));

    expect(res.status).toBe(403);
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it('lets a non-rep through and joins transcript fields onto each row', async () => {
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    fakeClient = fakeSupabase(
      'owner',
      [
        {
          id: 'c1',
          transcript_id: 't1',
          rep_email: 'jason@yulelovelights.com',
          vertical_slug: 'holiday',
          called_at: '2026-07-10T12:00:00Z',
          scored_at: '2026-07-10T12:05:00Z',
          overall: 88,
          experience_score: 9,
          fix: null,
        },
        {
          id: 'c2',
          transcript_id: 't2',
          rep_email: 'sam@yulelovelights.com',
          vertical_slug: 'permanent',
          called_at: '2026-07-09T12:00:00Z',
          scored_at: '2026-07-09T12:05:00Z',
          overall: 61,
          experience_score: 5,
          fix: { moment: 'rushed the close', timestamp_seconds: 90, transcript_quote: 'ok cool', better_line: 'Ask for the booking.' },
        },
      ],
      [
        { id: 't1', customer_name: 'Pat', outcome: 'booked', duration_seconds: 300 },
        { id: 't2', customer_name: 'Alex', outcome: 'not_booked', duration_seconds: 420 },
      ],
    );

    const res = await GET(new Request('http://localhost/api/coach/calls'));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.calls).toHaveLength(2);
    expect(json.calls[0]).toMatchObject({ id: 'c1', praise_only: true, customer_name: 'Pat', outcome: 'booked', duration_seconds: 300 });
    expect(json.calls[1]).toMatchObject({ id: 'c2', praise_only: false, customer_name: 'Alex', outcome: 'not_booked', duration_seconds: 420 });
  });

  it('degrades to a friendly reason when call_scores is not migrated yet', async () => {
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    fromMock = vi.fn((table: string) => {
      if (table === 'ops_employees') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'owner', active: true }, error: null }) }) }) };
      }
      if (table === 'call_scores') {
        return {
          select: () => ({
            eq: () => ({ order: () => ({ order: () => ({ limit: () => scoresQueryResult(null, { code: 'PGRST205', message: 'missing' }) }) }) }),
          }),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    });
    fakeClient = { from: fromMock } as unknown as SupabaseClient;

    const res = await GET(new Request('http://localhost/api/coach/calls'));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.migrated).toBe(false);
    expect(json.calls).toEqual([]);
  });

  it('applies the scoredAt~id pair cursor as an .or() filter on ?before=', async () => {
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    fakeClient = fakeSupabase('owner', []);

    const res = await GET(new Request('http://localhost/api/coach/calls?before=2026-07-10T12%3A05%3A00Z~c1'));

    expect(res.status).toBe(200);
    expect(lastOrFilter).toBe('scored_at.lt.2026-07-10T12:05:00Z,and(scored_at.eq.2026-07-10T12:05:00Z,id.lt.c1)');
  });

  it('still accepts a bare timestamp cursor for backward compatibility', async () => {
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    fakeClient = fakeSupabase('owner', []);

    const res = await GET(new Request('http://localhost/api/coach/calls?before=2026-07-10T12%3A05%3A00Z'));

    expect(res.status).toBe(200);
    expect(lastOrFilter).toBe('scored_at.lt.2026-07-10T12:05:00Z');
  });
});
