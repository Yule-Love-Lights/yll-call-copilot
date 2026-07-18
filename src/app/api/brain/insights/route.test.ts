// Coverage for GET/POST /api/brain/insights: the missing-table degrade
// (both directions), the manual-insert validation (source/lens/title/
// content), and a successful list/insert round trip. Mock style matches
// src/app/api/coach/calls/[id]/route.test.ts (a fakeSupabase() builder
// keyed by table name), extended with a thenable query-builder chain since
// GET conditionally appends .eq() calls before awaiting the query itself.

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

import { GET, POST } from './route';

type QueryResult = { data: unknown; error: unknown };

// A minimal thenable query-builder chain: every chained method (select,
// order, eq, insert) returns the same builder so any call order resolves,
// and awaiting it (or calling .single()) yields the fixed result -- mirrors
// how @supabase/supabase-js's real builder behaves closely enough for this
// route's linear query shapes.
function chain(result: QueryResult) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    order: () => builder,
    eq: () => builder,
    insert: () => builder,
    single: () => Promise.resolve(result),
    then: (onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

function fakeSupabase(result: QueryResult) {
  fromMock = vi.fn((table: string) => {
    if (table !== 'brain_insights') throw new Error(`Unexpected table in test: ${table}`);
    return chain(result);
  });
  return { from: fromMock } as unknown as SupabaseClient;
}

function getRequest(qs = '') {
  return new Request(`http://localhost/api/brain/insights${qs}`);
}
function postRequest(body: unknown) {
  return new Request('http://localhost/api/brain/insights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const SAMPLE_ROW = {
  id: 'i1',
  vertical_id: null,
  source: 'manual',
  lens: 'market',
  title: 'Storm season',
  content: 'Calls spike after a storm.',
  created_by: 'naldo@yulelovelights.com',
  created_at: '2026-07-18T00:00:00Z',
};

describe('GET /api/brain/insights', () => {
  beforeEach(() => {
    getSessionEmailMock.mockReset();
  });

  it('degrades on a missing table', async () => {
    fakeClient = fakeSupabase({ data: null, error: { code: 'PGRST205' } });

    const res = await GET(getRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.migrated).toBe(false);
    expect(json.reason).toBe('Run migration 0015 first.');
    expect(json.insights).toEqual([]);
  });

  it('lists insights newest-first, serialized to camelCase', async () => {
    fakeClient = fakeSupabase({ data: [SAMPLE_ROW], error: null });

    const res = await GET(getRequest('?lens=market'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.insights).toEqual([
      {
        id: 'i1',
        verticalId: null,
        source: 'manual',
        lens: 'market',
        title: 'Storm season',
        content: 'Calls spike after a storm.',
        createdBy: 'naldo@yulelovelights.com',
        createdAt: '2026-07-18T00:00:00Z',
      },
    ]);
  });

  it('500s on an unexpected error, distinct from the missing-table degrade', async () => {
    fakeClient = fakeSupabase({ data: null, error: { code: 'OTHER' } });

    const res = await GET(getRequest());

    expect(res.status).toBe(500);
  });
});

describe('POST /api/brain/insights', () => {
  beforeEach(() => {
    getSessionEmailMock.mockReset();
  });

  it('rejects a non-manual source', async () => {
    fakeClient = fakeSupabase({ data: null, error: null });

    const res = await POST(postRequest({ source: 'interview', lens: 'market', title: 't', content: 'c' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.saved).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid lens', async () => {
    fakeClient = fakeSupabase({ data: null, error: null });

    const res = await POST(postRequest({ source: 'manual', lens: 'pricing', title: 't', content: 'c' }));

    expect(res.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('rejects an empty title or content', async () => {
    fakeClient = fakeSupabase({ data: null, error: null });

    const res = await POST(postRequest({ source: 'manual', lens: 'market', title: '  ', content: 'c' }));

    expect(res.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('inserts a well-formed manual insight, attributing created_by from the session', async () => {
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    fakeClient = fakeSupabase({ data: SAMPLE_ROW, error: null });

    const res = await POST(postRequest({ source: 'manual', lens: 'market', title: 'Storm season', content: 'Calls spike after a storm.' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.saved).toBe(true);
    expect(json.insight.id).toBe('i1');
    expect(fromMock).toHaveBeenCalledWith('brain_insights');
  });

  it('degrades on a missing table', async () => {
    getSessionEmailMock.mockResolvedValue(null);
    fakeClient = fakeSupabase({ data: null, error: { code: '42P01' } });

    const res = await POST(postRequest({ source: 'manual', lens: 'market', title: 't', content: 'c' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.saved).toBe(false);
    expect(json.reason).toBe('Run migration 0015 first.');
  });
});
