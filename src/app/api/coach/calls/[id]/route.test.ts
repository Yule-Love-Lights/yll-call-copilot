// Coverage for the owner-facing role gate on GET /api/coach/calls/[id]: a
// rep gets a 403 and the route never touches call_scores/transcripts, a
// non-rep gets the full row plus its transcript, and a missing id 404s
// without ever querying transcripts. Mock style matches
// src/app/api/digest/[id]/route.test.ts.

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

function fakeSupabase(
  role: string | null,
  scoreRow: Record<string, unknown> | null = null,
  transcriptRow: Record<string, unknown> | null = null,
  recordingRow: Record<string, unknown> | null = null,
) {
  fromMock = vi.fn((table: string) => {
    if (table === 'app_users') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: role ? { role } : null, error: null }) }) }) };
    }
    if (table === 'call_scores') {
      const builder = { eq: () => builder, maybeSingle: async () => ({ data: scoreRow, error: null }) };
      return { select: () => builder };
    }
    if (table === 'transcripts') {
      const builder = { eq: () => builder, maybeSingle: async () => ({ data: transcriptRow, error: null }) };
      return { select: () => builder };
    }
    if (table === 'call_recordings') {
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: recordingRow, error: null }) }) }) }) };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });
  return { from: fromMock } as unknown as SupabaseClient;
}

function fakeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const SAMPLE_SCORE_ROW = {
  id: 'c1',
  transcript_id: 't1',
  rubric_version: 1,
  rep_email: 'jason@yulelovelights.com',
  vertical_slug: 'holiday',
  called_at: '2026-07-10T12:00:00Z',
  emotional: { state: 'excited', named_back: true, matched_track: true, grade: 9, notes: 'good read' },
  sales: {
    opening: { score: 14, max: 15, notes: '' },
    discovery: { score: 20, max: 25, notes: '' },
    value: { score: 18, max: 20, notes: '' },
    objections: { score: 18, max: 20, notes: '' },
    close: { score: 18, max: 20, notes: '' },
    total: 88,
  },
  hospitality: {
    greeting: { score: 18, max: 20, notes: '' },
    listening: { score: 18, max: 20, notes: '' },
    courtesy: { score: 18, max: 20, notes: '' },
    dead_air: { score: 18, max: 20, notes: '' },
    warm_ending: { score: 18, max: 20, notes: '' },
    total: 90,
  },
  hard_metrics: { rep_talk_ratio: 0.45, question_count: 6, dead_air_seconds: 3, interruption_count: 0, duration_seconds: 300 },
  experience: { cared_for: 9, at_ease: 9, excited: 8, notes: 'warm call' },
  experience_score: 9,
  guarantees: null,
  overall: 88,
  win: 'Named the state back and matched the track.',
  fix: null,
  scored_at: '2026-07-10T12:05:00Z',
};

const SAMPLE_TRANSCRIPT_ROW = {
  raw_text: 'Rep: hi\n\nCustomer: hello',
  customer_name: 'Pat',
  outcome: 'booked',
  duration_seconds: 300,
  called_at: '2026-07-10T12:00:00Z',
};

describe('GET /api/coach/calls/[id] -- role gate', () => {
  beforeEach(() => {
    getSessionEmailMock.mockReset();
  });

  it('403s a rep and never queries call_scores or transcripts', async () => {
    getSessionEmailMock.mockResolvedValue('rep@yulelovelights.com');
    fakeClient = fakeSupabase('rep');

    const res = await GET(new Request('http://localhost/api/coach/calls/c1'), fakeParams('c1'));

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Call review is for the coach's one-on-one prep, not a rep-facing page.");
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith('app_users');
  });

  it('404s an unknown id without ever querying transcripts', async () => {
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    fakeClient = fakeSupabase('owner', null);

    const res = await GET(new Request('http://localhost/api/coach/calls/missing'), fakeParams('missing'));

    expect(res.status).toBe(404);
    expect(fromMock).toHaveBeenCalledTimes(2);
    expect(fromMock).not.toHaveBeenCalledWith('transcripts');
  });

  it('lets a non-rep through to the full call plus its transcript, with has_recording false when there is no recording', async () => {
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    fakeClient = fakeSupabase('owner', SAMPLE_SCORE_ROW, SAMPLE_TRANSCRIPT_ROW, null);

    const res = await GET(new Request('http://localhost/api/coach/calls/c1'), fakeParams('c1'));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.call.id).toBe('c1');
    expect(json.call.win).toBe('Named the state back and matched the track.');
    expect(json.transcript.raw_text).toBe('Rep: hi\n\nCustomer: hello');
    expect(json.transcript.customer_name).toBe('Pat');
    expect(json.has_recording).toBe(false);
  });

  it('reports has_recording true when a transcribed GHL recording exists for this call', async () => {
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    fakeClient = fakeSupabase('owner', SAMPLE_SCORE_ROW, SAMPLE_TRANSCRIPT_ROW, { ghl_message_id: 'msg-1' });

    const res = await GET(new Request('http://localhost/api/coach/calls/c1'), fakeParams('c1'));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.has_recording).toBe(true);
  });
});
