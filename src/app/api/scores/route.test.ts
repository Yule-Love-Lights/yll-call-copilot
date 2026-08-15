// Coverage for the HIGH auth finding: GET had no role check, so any
// signed-in rep could pull EVERY rep's call_scores (including
// fix.transcript_quote and per-dimension notes) via ?rep=<other-rep>. Mocks
// session/role resolution directly (each has its own unit coverage --
// session.ts and role.test.ts) and a fake Supabase query builder, same style
// as src/lib/leads/queue.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const getSessionEmailMock = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getSessionEmail: (...args: unknown[]) => getSessionEmailMock(...args),
}));

const resolveStaffRoleMock = vi.fn();
vi.mock('@/lib/auth/role', () => ({
  resolveStaffRole: (...args: unknown[]) => resolveStaffRoleMock(...args),
}));

let fakeClient: SupabaseClient;
vi.mock('@/lib/supabase', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/supabase')>('../../../lib/supabase');
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    getSupabaseServerClient: () => fakeClient,
  };
});

import { GET } from './route';

type Row = { id: string; rep_email: string };

// One shared builder whose .eq() records every call and whose thenable
// resolves against whichever rep_email filter (if any) was applied --
// mirrors the real supabase-js query-builder chain (.select/.gte/.order/
// .limit all return the same builder; awaiting it resolves {data, error}).
function fakeSupabase(rowsByRep: Record<string, Row[]>) {
  const eqCalls: [string, unknown][] = [];
  const builder: {
    select: () => typeof builder;
    gte: () => typeof builder;
    order: () => typeof builder;
    limit: () => typeof builder;
    eq: (col: string, val: unknown) => typeof builder;
    then: (resolve: (v: { data: unknown; error: unknown }) => void) => void;
  } = {
    select: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => builder,
    eq: (col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return builder;
    },
    then: resolve => {
      const repFilter = eqCalls.find(([col]) => col === 'rep_email')?.[1] as string | undefined;
      const rows = repFilter ? (rowsByRep[repFilter] ?? []) : Object.values(rowsByRep).flat();
      resolve({ data: rows, error: null });
    },
  };
  const from = vi.fn(() => builder);
  return { client: { from } as unknown as SupabaseClient, eqCalls };
}

describe('GET /api/scores — rep role scoping (HIGH auth fix)', () => {
  beforeEach(() => {
    getSessionEmailMock.mockReset();
    resolveStaffRoleMock.mockReset();
  });

  it('a rep gets only their own rows, ignoring ?rep= targeting a teammate', async () => {
    getSessionEmailMock.mockResolvedValue('me@yulelovelights.com');
    resolveStaffRoleMock.mockResolvedValue('rep');
    const { client, eqCalls } = fakeSupabase({
      'me@yulelovelights.com': [{ id: '1', rep_email: 'me@yulelovelights.com' }],
      'other@yulelovelights.com': [{ id: '2', rep_email: 'other@yulelovelights.com' }],
    });
    fakeClient = client;

    const res = await GET(new Request('http://localhost/api/scores?rep=other@yulelovelights.com'));
    const json = await res.json();

    expect(eqCalls).toEqual([
      ['metric_scope', 'performance'],
      ['rep_email', 'me@yulelovelights.com'],
    ]);
    expect(json.scores.map((s: Row) => s.id)).toEqual(['1']);
  });

  it('a rep with no resolvable session email gets zero rows (fail closed)', async () => {
    getSessionEmailMock.mockResolvedValue(null);
    resolveStaffRoleMock.mockResolvedValue('rep');
    fakeClient = fakeSupabase({}).client;

    const res = await GET(new Request('http://localhost/api/scores'));
    const json = await res.json();

    expect(json.scores).toEqual([]);
  });

  it('an owner keeps current behavior: ?rep= targeting another rep still works', async () => {
    getSessionEmailMock.mockResolvedValue('boss@yulelovelights.com');
    resolveStaffRoleMock.mockResolvedValue('owner');
    const { client, eqCalls } = fakeSupabase({
      'other@yulelovelights.com': [{ id: '2', rep_email: 'other@yulelovelights.com' }],
    });
    fakeClient = client;

    const res = await GET(new Request('http://localhost/api/scores?rep=other@yulelovelights.com'));
    const json = await res.json();

    expect(eqCalls).toEqual([
      ['metric_scope', 'performance'],
      ['rep_email', 'other@yulelovelights.com'],
    ]);
    expect(json.scores.map((s: Row) => s.id)).toEqual(['2']);
  });

  it('an owner with no ?rep= sees every rep\'s rows (no filter applied)', async () => {
    getSessionEmailMock.mockResolvedValue('boss@yulelovelights.com');
    resolveStaffRoleMock.mockResolvedValue('owner');
    const { client, eqCalls } = fakeSupabase({
      a: [{ id: '1', rep_email: 'a' }],
      b: [{ id: '2', rep_email: 'b' }],
    });
    fakeClient = client;

    const res = await GET(new Request('http://localhost/api/scores'));
    const json = await res.json();

    expect(eqCalls).toEqual([['metric_scope', 'performance']]);
    expect(json.scores).toHaveLength(2);
  });
});
