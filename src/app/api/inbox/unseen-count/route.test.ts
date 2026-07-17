// Coverage for GET /api/inbox/unseen-count: same shape as
// GET /api/feedback/unseen-count (session required, no role check), scoped
// to inbound_emails with status in ('new', 'drafted'), degrading to
// { count: 0 } for every failure shape.

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

function unseenCountResult(count: number | null, error: unknown = null) {
  const builder: {
    in: () => typeof builder;
    then: (resolve: (v: { data: null; error: unknown; count: number | null }) => unknown) => unknown;
  } = {
    in: () => builder,
    then: resolve => Promise.resolve({ data: null, error, count }).then(resolve),
  };
  return builder;
}

function fakeSupabase(count: number | null, error: unknown = null) {
  const from = vi.fn((table: string) => {
    if (table === 'inbound_emails') {
      return { select: () => unseenCountResult(count, error) };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });
  return { from } as unknown as SupabaseClient;
}

describe('GET /api/inbox/unseen-count', () => {
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

  it('returns 0 without a session, and never queries inbound_emails', async () => {
    getSessionEmailMock.mockResolvedValue(null);
    const fromSpy = vi.fn();
    fakeClient = { from: fromSpy } as unknown as SupabaseClient;

    const res = await GET();
    const json = await res.json();

    expect(json).toEqual({ count: 0 });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('returns the new+drafted count for any signed-in staff member', async () => {
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    fakeClient = fakeSupabase(2);

    const res = await GET();
    const json = await res.json();

    expect(json).toEqual({ count: 2 });
  });

  it('degrades to 0 when inbound_emails is not migrated yet', async () => {
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    fakeClient = fakeSupabase(null, { code: 'PGRST205', message: 'missing' });

    const res = await GET();
    const json = await res.json();

    expect(json).toEqual({ count: 0 });
  });

  it('degrades to 0 on a genuine query error', async () => {
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    fakeClient = fakeSupabase(null, { code: '500', message: 'boom' });

    const res = await GET();
    const json = await res.json();

    expect(json).toEqual({ count: 0 });
  });
});
