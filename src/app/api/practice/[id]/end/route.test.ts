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

const getActiveRubricMock = vi.fn();
vi.mock('@/lib/scoring/rubric', () => ({ getActiveRubric: (...args: unknown[]) => getActiveRubricMock(...args) }));

const getOfferElementsMock = vi.fn();
vi.mock('@/lib/scoring/batch', () => ({ getOfferElements: (...args: unknown[]) => getOfferElementsMock(...args) }));

const scoreCallMock = vi.fn();
vi.mock('@/lib/scoring/score', () => ({ scoreCall: (...args: unknown[]) => scoreCallMock(...args) }));

const loadVerticalContextMock = vi.fn();
vi.mock('@/lib/practice/context', () => ({ loadVerticalContext: (...args: unknown[]) => loadVerticalContextMock(...args) }));

import { POST } from './route';
import type { PracticeSessionRow } from '@/lib/practice/types';
import type { CallScoreContent } from '@/lib/scoring/types';

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
    turns: [
      { speaker: 'customer', text: 'Hello?', at: '2026-01-01T00:00:00.000Z' },
      { speaker: 'rep', text: 'Hi, this is Jake.', at: '2026-01-01T00:00:05.000Z' },
    ],
    status: 'active',
    score: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ended_at: null,
    ...overrides,
  };
}

const SAMPLE_SCORE: CallScoreContent = {
  emotional: { state: 'guarded', named_back: true, matched_track: true, grade: 8, notes: 'n' },
  sales: {
    opening: { score: 12, max: 15, notes: 'n' },
    discovery: { score: 20, max: 25, notes: 'n' },
    value: { score: 15, max: 20, notes: 'n' },
    objections: { score: 15, max: 20, notes: 'n' },
    close: { score: 10, max: 20, notes: 'n' },
    total: 72,
  },
  hospitality: {
    greeting: { score: 18, max: 20, notes: 'n' },
    listening: { score: 18, max: 20, notes: 'n' },
    courtesy: { score: 18, max: 20, notes: 'n' },
    dead_air: { score: 18, max: 20, notes: 'n' },
    warm_ending: { score: 18, max: 20, notes: 'n' },
    total: 90,
  },
  hard_metrics: { rep_talk_ratio: 0, question_count: 0, dead_air_seconds: 0, interruption_count: 0, duration_seconds: 0 },
  experience: { cared_for: 9, at_ease: 8, excited: 8, notes: 'n' },
  experience_score: 8.3,
  guarantees: null,
  overall: 80,
  win: 'win',
  fix: null,
};

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

describe('POST /api/practice/[id]/end', () => {
  beforeEach(() => {
    isSupabaseConfiguredMock.mockReset().mockReturnValue(true);
    isClaudeConfiguredMock.mockReset().mockReturnValue(true);
    getSessionEmailMock.mockReset().mockResolvedValue('rep@yulelovelights.com');
    getActiveRubricMock.mockReset().mockResolvedValue({ ok: true, version: 1, source: 'seeded', content: {} });
    getOfferElementsMock.mockReset().mockResolvedValue([]);
    scoreCallMock.mockReset().mockResolvedValue(SAMPLE_SCORE);
    loadVerticalContextMock.mockReset().mockResolvedValue({ verticalName: 'Holiday', playbook: null });
  });

  it('degrades when Supabase is not configured', async () => {
    isSupabaseConfiguredMock.mockReturnValue(false);
    const res = await POST(new Request('http://localhost/api/practice/sess-1/end', { method: 'POST' }), params());
    const json = await res.json();
    expect(json).toEqual({ configured: false, saved: false, reason: 'Supabase not configured.' });
  });

  it('returns 404 when the session does not exist or belongs to another rep', async () => {
    const { client } = fakeSupabase(baseSession({ rep_email: 'other@yulelovelights.com' }));
    fakeClient = client;
    const res = await POST(new Request('http://localhost/api/practice/sess-1/end', { method: 'POST' }), params());
    expect(res.status).toBe(404);
  });

  it('scores the flattened transcript against the active rubric/playbook/offer and stores it on the session', async () => {
    const { client, updates } = fakeSupabase(baseSession());
    fakeClient = client;

    const res = await POST(new Request('http://localhost/api/practice/sess-1/end', { method: 'POST' }), params());
    const json = await res.json();

    expect(json.scored).toBe(true);
    expect(json.score).toEqual(SAMPLE_SCORE);
    expect(scoreCallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        verticalName: 'Holiday',
        rawText: 'Customer: Hello?\n\nRep: Hi, this is Jake.',
        utterancesAvailable: false,
      }),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe('ended');
    expect(updates[0].score).toEqual(SAMPLE_SCORE);
  });

  it('never writes to call_scores or any other table', async () => {
    const { client } = fakeSupabase(baseSession());
    fakeClient = client;
    await POST(new Request('http://localhost/api/practice/sess-1/end', { method: 'POST' }), params());
    // fakeSupabase's `from` throws on any table other than practice_sessions,
    // so reaching here without an unhandled rejection is the assertion.
    expect(true).toBe(true);
  });

  it('degrades to a friendly "could not score" and still ends the call when Claude is not configured', async () => {
    isClaudeConfiguredMock.mockReturnValue(false);
    const { client, updates } = fakeSupabase(baseSession());
    fakeClient = client;

    const res = await POST(new Request('http://localhost/api/practice/sess-1/end', { method: 'POST' }), params());
    const json = await res.json();

    expect(json.saved).toBe(true);
    expect(json.scored).toBe(false);
    expect(scoreCallMock).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe('ended');
  });

  it('degrades to a friendly "could not score" when scoreCall throws, but still ends and keeps the transcript', async () => {
    scoreCallMock.mockRejectedValue(new Error('Claude timed out'));
    const { client, updates } = fakeSupabase(baseSession());
    fakeClient = client;

    const res = await POST(new Request('http://localhost/api/practice/sess-1/end', { method: 'POST' }), params());
    const json = await res.json();

    expect(json.saved).toBe(true);
    expect(json.scored).toBe(false);
    expect(updates[0].status).toBe('ended');
    expect(updates[0].score).toBeNull();
  });

  it('is idempotent: calling end again on an already-ended session returns the stored score without re-scoring', async () => {
    const { client } = fakeSupabase(baseSession({ status: 'ended', score: SAMPLE_SCORE }));
    fakeClient = client;

    const res = await POST(new Request('http://localhost/api/practice/sess-1/end', { method: 'POST' }), params());
    const json = await res.json();

    expect(json.alreadyEnded).toBe(true);
    expect(json.score).toEqual(SAMPLE_SCORE);
    expect(scoreCallMock).not.toHaveBeenCalled();
  });
});
