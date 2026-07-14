import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getOfferElements, selectScoreCandidates, scoreNextBatch, type ScoreCandidate } from './batch';
import type { OfferElement } from './types';

const REAL_CALL_TEXT =
  'Rep: Hi, this is Jake with Yule Love Lights, thanks for calling in today, how can I help?\n\n'.repeat(10) +
  "Customer: Hi, I saw your lights on my neighbor's house and wanted a quote.\n\n";

function candidate(id: string, overrides: Partial<ScoreCandidate> = {}): ScoreCandidate {
  return { id, raw_text: REAL_CALL_TEXT, utterances: null, ...overrides };
}

describe('selectScoreCandidates', () => {
  it('excludes already-scored transcripts', () => {
    const candidates = [candidate('a'), candidate('b'), candidate('c')];
    const result = selectScoreCandidates(candidates, new Set(['b']), 10);
    expect(result.map(c => c.id)).toEqual(['a', 'c']);
  });

  it('excludes non-substantive transcripts (too short)', () => {
    const candidates = [candidate('a'), candidate('b', { raw_text: 'too short' })];
    const result = selectScoreCandidates(candidates, new Set(), 10);
    expect(result.map(c => c.id)).toEqual(['a']);
  });

  it('caps the result at the given limit, preserving order (newest-first is the caller\'s ordering)', () => {
    const candidates = [candidate('a'), candidate('b'), candidate('c')];
    const result = selectScoreCandidates(candidates, new Set(), 2);
    expect(result.map(c => c.id)).toEqual(['a', 'b']);
  });

  it('returns an empty array when nothing qualifies', () => {
    const result = selectScoreCandidates([candidate('a')], new Set(['a']), 10);
    expect(result).toEqual([]);
  });
});

function offerElement(overrides: Partial<OfferElement> = {}): OfferElement {
  return {
    key: 'fast_fix_48h',
    name: 'name',
    customer_line: 'line',
    grade_hint: 'hint',
    applies_to: 'any call',
    situational: false,
    ...overrides,
  };
}

function offerVersionsClient(elements: OfferElement[]) {
  const from = vi.fn((table: string) => {
    if (table !== 'offer_versions') throw new Error(`Unexpected table in test: ${table}`);
    return {
      select: () => ({
        order: () => ({
          limit: () => ({
            maybeSingle: () => Promise.resolve({ data: { content: { elements } }, error: null }),
          }),
        }),
      }),
    };
  });
  return { from } as unknown as SupabaseClient;
}

describe('getOfferElements — active flag (fix: a deactivated offer element must not reach the scorer)', () => {
  it('filters out an element with active === false', async () => {
    const client = offerVersionsClient([
      offerElement({ key: 'fast_fix_48h', active: true }),
      offerElement({ key: 'referral_ask', active: false }),
    ]);

    const result = await getOfferElements(client);

    expect(result.map(e => e.key)).toEqual(['fast_fix_48h']);
  });

  it('treats a missing active field as active (backward compatible with content saved before this field existed)', async () => {
    const client = offerVersionsClient([offerElement({ key: 'fast_fix_48h' })]);

    const result = await getOfferElements(client);

    expect(result).toHaveLength(1);
  });

  it('falls back to DEFAULT_OFFER_ELEMENTS when every stored element is deactivated', async () => {
    const client = offerVersionsClient([offerElement({ key: 'fast_fix_48h', active: false })]);

    const result = await getOfferElements(client);

    expect(result.length).toBeGreaterThan(0);
    expect(result.every(e => e.active !== false)).toBe(true);
  });
});

// ─── scoreNextBatch — rep_email attribution (fix: the recordings pipeline
// never creates a `calls` row, so scoring must prefer transcripts.rep_email
// over the calls-table lookup, or every recording-sourced score loses its
// rep attribution and vanishes from feedback/digest/scoreboard) ───────────

vi.mock('../claude', () => ({ isClaudeConfigured: () => true }));

const scoreCallMock = vi.fn();
vi.mock('./score', () => ({
  scoreCall: (...args: unknown[]) => scoreCallMock(...args),
}));

vi.mock('./rubric', () => ({
  getActiveRubric: () =>
    Promise.resolve({ ok: true, version: 1, source: 'seeded', content: {} }),
}));

type TranscriptRow = {
  id: string;
  raw_text: string;
  vertical_id: string | null;
  called_at: string | null;
  utterances: null;
  rep_email?: string | null;
};

function fakeScoringSupabase(opts: { transcripts: TranscriptRow[]; callsRepEmailById?: Record<string, string | null> }) {
  const upserts: Record<string, unknown>[] = [];
  const callsQueriedIds: string[] = [];

  const from = vi.fn((table: string) => {
    if (table === 'transcripts') {
      return {
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: opts.transcripts, error: null }),
          }),
        }),
      };
    }
    if (table === 'call_scores') {
      return {
        select: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
        }),
        upsert: (row: Record<string, unknown>) => {
          upserts.push(row);
          return Promise.resolve({ error: null });
        },
      };
    }
    if (table === 'calls') {
      return {
        select: () => ({
          eq: (_col: string, id: string) => ({
            maybeSingle: () => {
              callsQueriedIds.push(id);
              const repEmail = opts.callsRepEmailById?.[id];
              return Promise.resolve({ data: repEmail !== undefined ? { rep_email: repEmail } : null, error: null });
            },
          }),
        }),
      };
    }
    if (table === 'verticals') {
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
    }
    if (table === 'offer_versions') {
      return {
        select: () => ({
          order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        }),
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return { client: { from } as unknown as SupabaseClient, upserts, callsQueriedIds };
}

const sampleScoreContent = {
  emotional: { state: 'excited', named_back: true, matched_track: true, grade: 9, notes: 'n' },
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
  hard_metrics: { rep_talk_ratio: 0.4, question_count: 3, dead_air_seconds: 0, interruption_count: 0, duration_seconds: 300 },
  experience: { cared_for: 9, at_ease: 9, excited: 9, notes: 'n' },
  experience_score: 9,
  guarantees: null,
  overall: 83.7,
  win: 'win',
  fix: null,
};

describe('scoreNextBatch — rep_email attribution (fix 2)', () => {
  beforeEach(() => {
    scoreCallMock.mockReset().mockResolvedValue(sampleScoreContent);
  });

  it('prefers transcripts.rep_email over the calls-table lookup, and lowercases it', async () => {
    const { client, upserts, callsQueriedIds } = fakeScoringSupabase({
      transcripts: [
        {
          id: 't1',
          raw_text: REAL_CALL_TEXT,
          vertical_id: null,
          called_at: '2026-07-01T00:00:00Z',
          utterances: null,
          rep_email: 'Jake@YuleLoveLights.com',
        },
      ],
    });

    const result = await scoreNextBatch(client, 8);

    expect(result).toEqual({ scored: 1, skipped: 0, failed: 0 });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].rep_email).toBe('jake@yulelovelights.com');
    // transcripts.rep_email already resolved it -- no need to spend a second
    // query against the calls table.
    expect(callsQueriedIds).toEqual([]);
  });

  it('falls back to the calls-table lookup when transcripts.rep_email is null, and lowercases that too', async () => {
    const { client, upserts, callsQueriedIds } = fakeScoringSupabase({
      transcripts: [
        {
          id: 't2',
          raw_text: REAL_CALL_TEXT,
          vertical_id: null,
          called_at: '2026-07-01T00:00:00Z',
          utterances: null,
          rep_email: null,
        },
      ],
      callsRepEmailById: { t2: 'Pat@YuleLoveLights.com' },
    });

    const result = await scoreNextBatch(client, 8);

    expect(result).toEqual({ scored: 1, skipped: 0, failed: 0 });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].rep_email).toBe('pat@yulelovelights.com');
    expect(callsQueriedIds).toEqual(['t2']);
  });

  it('stores null rep_email when neither transcripts nor calls has one', async () => {
    const { client, upserts } = fakeScoringSupabase({
      transcripts: [
        { id: 't3', raw_text: REAL_CALL_TEXT, vertical_id: null, called_at: '2026-07-01T00:00:00Z', utterances: null, rep_email: null },
      ],
      callsRepEmailById: { t3: null },
    });

    await scoreNextBatch(client, 8);

    expect(upserts[0].rep_email).toBeNull();
  });
});
