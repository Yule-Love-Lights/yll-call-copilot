import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const isSupabaseConfiguredMock = vi.fn();
let fakeClient: SupabaseClient;
vi.mock('@/lib/supabase', async () => {
  const actual = await vi.importActual<typeof import('../../../../../lib/supabase')>('../../../../../lib/supabase');
  return {
    ...actual,
    isSupabaseConfigured: () => isSupabaseConfiguredMock(),
    getSupabaseServerClient: () => fakeClient,
  };
});

const isClaudeConfiguredMock = vi.fn();
vi.mock('@/lib/claude', () => ({ isClaudeConfigured: () => isClaudeConfiguredMock() }));

const getSessionEmailMock = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSessionEmail: (...args: unknown[]) => getSessionEmailMock(...args) }));

const customerReplyMock = vi.fn();
vi.mock('@/lib/practice/customer', () => ({ customerReply: (...args: unknown[]) => customerReplyMock(...args) }));

const buildSessionSystemPromptMock = vi.fn();
vi.mock('@/lib/practice/context', () => ({
  buildSessionSystemPrompt: (...args: unknown[]) => buildSessionSystemPromptMock(...args),
}));

import { POST, MAX_REP_TURNS, MAX_TURN_TEXT_LENGTH } from './route';
import type { PracticeSessionRow } from '@/lib/practice/types';

function request(body: unknown) {
  return new Request('http://localhost/api/practice/sess-1/turn', { method: 'POST', body: JSON.stringify(body) });
}

function params(id = 'sess-1') {
  return { params: Promise.resolve({ id }) };
}

function baseSession(overrides: Partial<PracticeSessionRow> = {}): PracticeSessionRow {
  return {
    id: 'sess-1',
    rep_email: 'rep@yulelovelights.com',
    vertical_slug: 'holiday',
    emotional_state: 'guarded',
    objective: null,
    turns: [{ speaker: 'customer', text: 'Hello?', at: '2026-01-01T00:00:00.000Z' }],
    status: 'active',
    score: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ended_at: null,
    ...overrides,
  };
}

// A fake `practice_sessions` table: select().eq().maybeSingle() reads the
// LIVE row, and update(patch).eq('id',...).eq('status','active').select()
// is a real compare-and-swap -- it only applies (and returns a row) when
// the live status still matches the filter. The returned `row` reference is
// exposed (not just a snapshot) so a test can mutate it mid-request -- e.g.
// from inside customerReplyMock's implementation -- to model a concurrent
// /end claiming the session while this /turn was awaiting Claude.
function fakeSupabase(session: PracticeSessionRow | null, sessionError: unknown = null) {
  const row: PracticeSessionRow | null = session ? { ...session } : null;
  const updates: Record<string, unknown>[] = [];

  function makeUpdateBuilder(patch: Record<string, unknown>) {
    const filters: Record<string, unknown> = {};
    function resolve() {
      if (!row) return Promise.resolve({ data: [], error: null });
      if ('status' in filters && filters.status !== row.status) {
        return Promise.resolve({ data: [], error: null });
      }
      Object.assign(row, patch);
      updates.push({ ...patch });
      return Promise.resolve({ data: [{ id: row.id }], error: null });
    }
    const builder = {
      eq(field: string, value: unknown) {
        filters[field] = value;
        return builder;
      },
      select() {
        return resolve();
      },
      then(onFulfilled: (v: { data: unknown; error: null }) => unknown, onRejected?: (e: unknown) => unknown) {
        return resolve().then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  const from = vi.fn((table: string) => {
    if (table !== 'practice_sessions') throw new Error(`Unexpected table in test: ${table}`);
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: row ? { ...row } : null, error: sessionError }),
        }),
      }),
      update: (patch: Record<string, unknown>) => makeUpdateBuilder(patch),
    };
  });
  return { client: { from } as unknown as SupabaseClient, updates, row };
}

describe('POST /api/practice/[id]/turn', () => {
  beforeEach(() => {
    isSupabaseConfiguredMock.mockReset().mockReturnValue(true);
    isClaudeConfiguredMock.mockReset().mockReturnValue(true);
    getSessionEmailMock.mockReset().mockResolvedValue('rep@yulelovelights.com');
    customerReplyMock.mockReset().mockResolvedValue('That sounds nice.');
    buildSessionSystemPromptMock.mockReset().mockResolvedValue('system prompt');
  });

  it('degrades when Supabase is not configured', async () => {
    isSupabaseConfiguredMock.mockReturnValue(false);
    const res = await POST(request({ text: 'Hi there' }), params());
    const json = await res.json();
    expect(json).toEqual({ configured: false, saved: false, reason: 'Supabase not configured.' });
  });

  it('rejects an empty text body with 400', async () => {
    const res = await POST(request({ text: '   ' }), params());
    expect(res.status).toBe(400);
  });

  it('returns 404 when the session does not exist', async () => {
    const { client } = fakeSupabase(null);
    fakeClient = client;
    const res = await POST(request({ text: 'Hi there' }), params());
    expect(res.status).toBe(404);
  });

  it('returns 404 (never 403) when the session belongs to a different rep', async () => {
    const { client } = fakeSupabase(baseSession({ rep_email: 'other@yulelovelights.com' }));
    fakeClient = client;
    const res = await POST(request({ text: 'Hi there' }), params());
    expect(res.status).toBe(404);
  });

  it('returns 409 when the call already ended', async () => {
    const { client } = fakeSupabase(baseSession({ status: 'ended' }));
    fakeClient = client;
    const res = await POST(request({ text: 'Hi there' }), params());
    expect(res.status).toBe(409);
  });

  it('appends the rep turn and the AI customer reply, and saves both', async () => {
    const { client, updates } = fakeSupabase(baseSession());
    fakeClient = client;

    const res = await POST(request({ text: 'Hi, this is Jake with Yule Love Lights.' }), params());
    const json = await res.json();

    expect(json).toEqual({ configured: true, saved: true, reply: 'That sounds nice.' });
    expect(updates).toHaveLength(1);
    const savedTurns = updates[0].turns as { speaker: string; text: string }[];
    expect(savedTurns.map(t => t.speaker)).toEqual(['customer', 'rep', 'customer']);
    expect(savedTurns[1].text).toBe('Hi, this is Jake with Yule Love Lights.');
    expect(savedTurns[2].text).toBe('That sounds nice.');

    // The system prompt is rebuilt from the session's saved scenario, not
    // re-derived from the request body.
    expect(buildSessionSystemPromptMock).toHaveBeenCalledWith(expect.anything(), {
      verticalSlug: 'holiday',
      emotionalState: 'guarded',
      objective: null,
    });
  });

  it('degrades with a friendly reason when Claude is not configured, without saving a partial turn', async () => {
    isClaudeConfiguredMock.mockReturnValue(false);
    const { client, updates } = fakeSupabase(baseSession());
    fakeClient = client;

    const res = await POST(request({ text: 'Hi there' }), params());
    const json = await res.json();

    expect(json.saved).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('returns 409 at the turn cap without calling Claude', async () => {
    const cappedTurns = Array.from({ length: MAX_REP_TURNS }, (_, i) => ({
      speaker: 'rep' as const,
      text: `rep turn ${i}`,
      at: '2026-01-01T00:00:00.000Z',
    }));
    const { client } = fakeSupabase(baseSession({ turns: cappedTurns }));
    fakeClient = client;

    const res = await POST(request({ text: 'One more thing' }), params());
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toMatch(/length limit/);
    expect(customerReplyMock).not.toHaveBeenCalled();
    expect(buildSessionSystemPromptMock).not.toHaveBeenCalled();
  });

  it('returns 409 when a concurrent /end claims the session while this turn is in flight, and does not save the turn', async () => {
    const { client, row, updates } = fakeSupabase(baseSession());
    fakeClient = client;
    // The AI reply comes back fine, but by the time we go to save the turn
    // another request has already ended the session (same shape as a real
    // race: /end's claim commits while this /turn is awaiting Claude).
    customerReplyMock.mockImplementation(async () => {
      row!.status = 'ended';
      return 'That sounds nice.';
    });

    const res = await POST(request({ text: 'Hi there' }), params());
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('This practice call has ended.');
    expect(updates).toHaveLength(0);
  });

  it('rejects turn text longer than 4000 characters with 400, before touching Claude', async () => {
    const res = await POST(request({ text: 'a'.repeat(MAX_TURN_TEXT_LENGTH + 1) }), params());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/too long/);
    expect(customerReplyMock).not.toHaveBeenCalled();
  });
});
