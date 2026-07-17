// Coverage for GET /api/feedback/unseen-count: it only ever needs a
// session (no role check -- "role-free"), scopes the count to the caller's
// own rep_email + seen_at IS NULL, and degrades to { count: 0 } rather than
// an error for every failure shape (no session, Supabase unconfigured, a
// query error, an un-migrated table). Mock style matches
// src/app/api/coach/calls/route.test.ts / src/app/api/digest/route.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const getSessionEmailMock = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getSessionEmail: (...args: unknown[]) => getSessionEmailMock(...args),
}));

let configured = true;
let fakeClient: SupabaseClient;
vi.mock('@/lib/supabase', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase')>('@/lib/supabase');
  return {
    ...actual,
    isSupabaseConfigured: () => configured,
    getSupabaseServerClient: () => fakeClient,
  };
});

import { GET } from './route';

// A thenable query-builder stub, same shape as the one in
// src/app/api/coach/calls/route.test.ts: `.eq()`/`.is()` return the same
// object so the caller can chain either order, and `await`-ing it resolves
// to {data, error, count}.
function unseenCountResult(count: number | null, error: unknown = null) {
  const builder: {
    eq: () => typeof builder;
    is: () => typeof builder;
    then: (resolve: (v: { data: null; error: unknown; count: number | null }) => unknown) => unknown;
  } = {
    eq: () => builder,
    is: () => builder,
    then: resolve => Promise.resolve({ data: null, error, count }).then(resolve),
  };
  return builder;
}

function fakeSupabase(count: number | null, error: unknown = null) {
  const from = vi.fn((table: string) => {
    if (table === 'feedback_cards') {
      return { select: () => unseenCountResult(count, error) };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });
  return { from } as unknown as SupabaseClient;
}

describe('GET /api/feedback/unseen-count', () => {
  beforeEach(() => {
    configured = true;
    getSessionEmailMock.mockReset();
  });

  it('returns 0 without querying anything when Supabase is not configured', async () => {
    configured = false;

    const res = await GET();
    const json = await res.json();

    expect(json).toEqual({ count: 0 });
    expect(getSessionEmailMock).not.toHaveBeenCalled();
  });

  it('returns 0 without a session, and never queries feedback_cards', async () => {
    getSessionEmailMock.mockResolvedValue(null);
    const fromSpy = vi.fn();
    fakeClient = { from: fromSpy } as unknown as SupabaseClient;

    const res = await GET();
    const json = await res.json();

    expect(json).toEqual({ count: 0 });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("returns the signed-in rep's own unseen count", async () => {
    getSessionEmailMock.mockResolvedValue('jamie@yulelovelights.com');
    fakeClient = fakeSupabase(3);

    const res = await GET();
    const json = await res.json();

    expect(json).toEqual({ count: 3 });
  });

  it('degrades to 0 when feedback_cards is not migrated yet', async () => {
    getSessionEmailMock.mockResolvedValue('jamie@yulelovelights.com');
    fakeClient = fakeSupabase(null, { code: 'PGRST205', message: 'missing' });

    const res = await GET();
    const json = await res.json();

    expect(json).toEqual({ count: 0 });
  });

  it('degrades to 0 on a genuine query error', async () => {
    getSessionEmailMock.mockResolvedValue('jamie@yulelovelights.com');
    fakeClient = fakeSupabase(null, { code: '500', message: 'boom' });

    const res = await GET();
    const json = await res.json();

    expect(json).toEqual({ count: 0 });
  });
});
