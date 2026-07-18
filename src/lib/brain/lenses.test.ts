// Coverage for the pure aggregation in src/lib/brain/lenses.ts: the shared
// topByFrequency dedupe helper, each of the three lenses (market/leads/
// coaching) against fixture rows, the brain_insights lens-filtering rule
// (a lens's own insights plus 'general', never a sibling lens's), and the
// stats-strip helper. No Supabase here — same fixture-only convention as
// src/lib/digest/stats.test.ts and src/lib/analytics/stats.test.ts; the
// loader (src/lib/brain/loader.ts) is untested, same split as every other
// route/loader pair in this app.

import { describe, it, expect } from 'vitest';
import {
  buildBrainStats,
  buildCoachingLens,
  buildLeadsLens,
  buildMarketLens,
  topByFrequency,
  type BrainInsight,
  type CoachingCallRow,
} from './lenses';

function insight(overrides: Partial<BrainInsight> & { id: string; lens: BrainInsight['lens'] }): BrainInsight {
  return {
    verticalId: null,
    verticalName: null,
    source: 'manual',
    title: 'Some insight',
    content: 'Some content',
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('topByFrequency', () => {
  it('dedupes case-insensitively, keeping the first-seen casing, sorted by count', () => {
    const result = topByFrequency(['Too expensive', 'too expensive', 'Not now', 'TOO EXPENSIVE'], 10);
    expect(result).toEqual([
      { item: 'Too expensive', count: 3 },
      { item: 'Not now', count: 1 },
    ]);
  });

  it('trims and skips blank entries', () => {
    expect(topByFrequency(['  ', '', 'Great fit'], 10)).toEqual([{ item: 'Great fit', count: 1 }]);
  });

  it('respects the limit', () => {
    expect(topByFrequency(['a', 'b', 'c'], 2)).toHaveLength(2);
  });
});

describe('buildMarketLens', () => {
  const verticals = [
    { id: 'v1', name: 'Holiday', knowledgeNotes: 'Book early, before Thanksgiving.' },
    { id: 'v2', name: 'Permanent', knowledgeNotes: '' },
  ];

  it('only includes verticals with non-empty knowledge notes', () => {
    const result = buildMarketLens({ verticals, documents: [], customerLanguage: [], insights: [] });
    expect(result.verticalNotes).toEqual([{ verticalId: 'v1', verticalName: 'Holiday', notes: 'Book early, before Thanksgiving.' }]);
  });

  it('groups documents by vertical, sorted by count descending', () => {
    const documents = [
      { id: 'd1', verticalId: 'v2', title: 'Permanent FAQ', kind: 'note' as const, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'd2', verticalId: 'v1', title: 'Holiday pricing', kind: 'upload' as const, createdAt: '2026-01-03T00:00:00.000Z' },
      { id: 'd3', verticalId: 'v1', title: 'Holiday script', kind: 'note' as const, createdAt: '2026-01-02T00:00:00.000Z' },
    ];
    const result = buildMarketLens({ verticals, documents, customerLanguage: [], insights: [] });
    expect(result.documentsTotal).toBe(3);
    expect(result.documentsByVertical).toEqual([
      { verticalId: 'v1', verticalName: 'Holiday', count: 2 },
      { verticalId: 'v2', verticalName: 'Permanent', count: 1 },
    ]);
    // Newest first.
    expect(result.recentDocuments.map(d => d.id)).toEqual(['d2', 'd3', 'd1']);
  });

  it('surfaces the top customer-language phrases by frequency', () => {
    const result = buildMarketLens({
      verticals,
      documents: [],
      customerLanguage: ['too pricey', 'Too Pricey', 'not sure yet'],
      insights: [],
    });
    expect(result.topCustomerLanguage).toEqual([
      { phrase: 'too pricey', count: 2 },
      { phrase: 'not sure yet', count: 1 },
    ]);
  });

  it('includes market-lensed and general insights, but not leads/coaching ones', () => {
    const insights = [
      insight({ id: 'i1', lens: 'market' }),
      insight({ id: 'i2', lens: 'general' }),
      insight({ id: 'i3', lens: 'leads' }),
      insight({ id: 'i4', lens: 'coaching' }),
    ];
    const result = buildMarketLens({ verticals, documents: [], customerLanguage: [], insights });
    expect(result.insights.map(i => i.id).sort()).toEqual(['i1', 'i2']);
  });
});

describe('buildLeadsLens', () => {
  const verticals = [
    { id: 'v1', name: 'Holiday' },
    { id: 'v2', name: 'Permanent' },
  ];

  it('computes the outcome mix and a null bookedRate when nothing is known yet', () => {
    const result = buildLeadsLens({ verticals, transcripts: [], learningsObjections: [], insights: [] });
    expect(result.outcomeMix).toEqual({ booked: 0, notBooked: 0, unknown: 0, total: 0, bookedRate: null });
  });

  it('computes bookedRate from known-outcome transcripts only, excluding unknown from the denominator', () => {
    const transcripts = [
      { verticalId: 'v1', outcome: 'booked' as const },
      { verticalId: 'v1', outcome: 'booked' as const },
      { verticalId: 'v1', outcome: 'not_booked' as const },
      { verticalId: 'v1', outcome: 'unknown' as const },
    ];
    const result = buildLeadsLens({ verticals, transcripts, learningsObjections: [], insights: [] });
    expect(result.outcomeMix).toEqual({ booked: 2, notBooked: 1, unknown: 1, total: 4, bookedRate: 66.7 });
  });

  it('ranks verticals by bookedRate descending, with no-data verticals sorting last', () => {
    const transcripts = [
      { verticalId: 'v1', outcome: 'booked' as const },
      { verticalId: 'v1', outcome: 'not_booked' as const },
      { verticalId: 'v1', outcome: 'not_booked' as const },
      { verticalId: 'v1', outcome: 'not_booked' as const },
      { verticalId: 'v2', outcome: 'booked' as const },
      { verticalId: 'v2', outcome: 'not_booked' as const },
    ];
    const result = buildLeadsLens({ verticals, transcripts, learningsObjections: [], insights: [] });
    expect(result.byVertical.map(v => v.verticalId)).toEqual(['v2', 'v1']);
  });

  it('counts an objection at most once per call (learnings row), not once per mention', () => {
    const learningsObjections = [
      { objections: [{ objection: 'Too expensive', customer_words: '', rep_response: '', worked: null }, { objection: 'too expensive', customer_words: '', rep_response: '', worked: null }] },
      { objections: [{ objection: 'Not now', customer_words: '', rep_response: '', worked: null }] },
    ];
    const result = buildLeadsLens({ verticals, transcripts: [], learningsObjections, insights: [] });
    expect(result.topObjections).toEqual([
      { objection: 'Too expensive', count: 1, pct: 50 },
      { objection: 'Not now', count: 1, pct: 50 },
    ]);
  });

  it('includes leads-lensed and general insights only', () => {
    const insights = [insight({ id: 'i1', lens: 'leads' }), insight({ id: 'i2', lens: 'general' }), insight({ id: 'i3', lens: 'market' })];
    const result = buildLeadsLens({ verticals, transcripts: [], learningsObjections: [], insights });
    expect(result.insights.map(i => i.id).sort()).toEqual(['i1', 'i2']);
  });
});

describe('buildCoachingLens', () => {
  function callRow(overrides: Partial<CoachingCallRow>): CoachingCallRow {
    return {
      repEmail: 'rep@yulelovelights.com',
      overall: 70,
      experienceScore: 7,
      emotional: { state: 'excited', namedBack: true, matchedTrack: true, grade: 7, notes: null },
      sales: {
        opening: { score: 12, max: 15 },
        discovery: { score: 20, max: 25 },
        value: { score: 16, max: 20 },
        objections: { score: 15, max: 20 },
        close: { score: 15, max: 20 },
      },
      hospitality: {
        greeting: { score: 8, max: 10 },
        listening: { score: 8, max: 10 },
        courtesy: { score: 8, max: 10 },
        dead_air: { score: 4, max: 10 },
        warm_ending: { score: 8, max: 10 },
      },
      ...overrides,
    };
  }

  it('never carries a win or fix field on its output shape (aggregate only)', () => {
    const result = buildCoachingLens({ callScores: [callRow({})], learningsRows: [], pendingProposals: 0, insights: [] });
    expect(result).not.toHaveProperty('win');
    expect(result).not.toHaveProperty('fix');
    expect(JSON.stringify(result)).not.toMatch(/"fix"|"win"/);
  });

  it('reuses the digest team-average and lowest-dimension math', () => {
    const result = buildCoachingLens({
      callScores: [callRow({ overall: 60 }), callRow({ overall: 80 })],
      learningsRows: [],
      pendingProposals: 0,
      insights: [],
    });
    expect(result.team).toEqual({ calls: 2, reps: 1, avgOverall: 70, avgExperience: 7 });
    // dead_air (4/10 = 40%) is the weakest dimension in the fixture.
    expect(result.lowestDimensions[0].key).toBe('hospitality_dead_air');
  });

  it('aggregates what-worked/what-failed themes by frequency across every learnings row', () => {
    const result = buildCoachingLens({
      callScores: [],
      learningsRows: [
        { whatWorked: ['Named the guarantee', 'named the guarantee'], whatFailed: ['Talked over the customer'] },
        { whatWorked: ['Asked about budget'], whatFailed: [] },
      ],
      pendingProposals: 3,
      insights: [],
    });
    expect(result.topWhatWorked[0]).toEqual({ item: 'Named the guarantee', count: 2 });
    expect(result.topWhatFailed).toEqual([{ item: 'Talked over the customer', count: 1 }]);
    expect(result.pendingProposals).toBe(3);
  });

  it('handles the empty-team case without dividing by zero', () => {
    const result = buildCoachingLens({ callScores: [], learningsRows: [], pendingProposals: 0, insights: [] });
    expect(result.team).toEqual({ calls: 0, reps: 0, avgOverall: null, avgExperience: null });
    expect(result.lowestDimensions).toEqual([]);
  });

  it('includes coaching-lensed and general insights only', () => {
    const insights = [insight({ id: 'i1', lens: 'coaching' }), insight({ id: 'i2', lens: 'general' }), insight({ id: 'i3', lens: 'leads' })];
    const result = buildCoachingLens({ callScores: [], learningsRows: [], pendingProposals: 0, insights });
    expect(result.insights.map(i => i.id).sort()).toEqual(['i1', 'i2']);
  });
});

describe('buildBrainStats', () => {
  it('counts learnings rows and picks the most recent extracted_at', () => {
    const result = buildBrainStats({
      learningsExtractedAt: ['2026-01-01T00:00:00.000Z', '2026-01-03T00:00:00.000Z', '2026-01-02T00:00:00.000Z'],
      callsScoredCount: 5,
    });
    expect(result).toEqual({ transcriptsLearned: 3, callsScored: 5, lastLearnedAt: '2026-01-03T00:00:00.000Z' });
  });

  it('returns a null lastLearnedAt when nothing has been learned yet', () => {
    expect(buildBrainStats({ learningsExtractedAt: [], callsScoredCount: 0 })).toEqual({
      transcriptsLearned: 0,
      callsScored: 0,
      lastLearnedAt: null,
    });
  });
});
