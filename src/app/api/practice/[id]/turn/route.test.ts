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

import { POST } from './route';
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

function fakeSupabase(session: PracticeSessionRow | null, sessionError: unknown = null) {
  const updates: Record<string, unknown>[] = [];
  const from = vi.fn((table: string) => {
    if (table !== 'practice_sessions') throw new Error(`Unexpected table in test: ${table}`);
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: session, error: sessionError }),
        }),
      }),
      update: (row: Record<string, unknown>) => {
        updates.push(row);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    };
  });
  return { client: { from } as unknown as SupabaseClient, updates };
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
});
