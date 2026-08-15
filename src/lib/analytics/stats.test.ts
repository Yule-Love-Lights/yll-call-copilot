// Coverage for the pure parts of src/lib/analytics/stats.ts: computeStats
// (fixture rows -> exact numbers, including the version-attribution
// approximation), attributeVersion's boundary behavior, topNoiseCardTexts,
// and the date-range/period boundary logic behind GET /api/analytics and
// POST /api/verticals/[id]/brain-review. The Supabase-touching loader
// (loadStatsInputs/loadStats) is untested here, same convention as every
// other route/loader split in this app (see src/lib/leads/calls.ts).

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  attributeVersion,
  computeStats,
  dateRangeToTimestamps,
  loadStatsInputs,
  parseDateRange,
  periodFromDays,
  topNoiseCardTexts,
  type StatsInputs,
} from './stats';

describe('attributeVersion', () => {
  const versions = [
    { version: 1, createdAt: '2026-01-01T00:00:00.000Z' },
    { version: 2, createdAt: '2026-02-01T00:00:00.000Z' },
  ];

  it('returns null when the call predates every version', () => {
    expect(attributeVersion('2025-12-01T00:00:00.000Z', versions)).toBeNull();
  });

  it('attributes to the version active at that time', () => {
    expect(attributeVersion('2026-01-15T00:00:00.000Z', versions)).toBe(1);
    expect(attributeVersion('2026-03-01T00:00:00.000Z', versions)).toBe(2);
  });

  it('treats a call exactly at a version\'s created_at as already on that version', () => {
    expect(attributeVersion('2026-02-01T00:00:00.000Z', versions)).toBe(2);
  });

  it('does not depend on input order', () => {
    const reversed = [versions[1], versions[0]];
    expect(attributeVersion('2026-01-15T00:00:00.000Z', reversed)).toBe(1);
  });

  it('returns null for an empty version list', () => {
    expect(attributeVersion('2026-01-15T00:00:00.000Z', [])).toBeNull();
  });
});

describe('loadStatsInputs metric provenance', () => {
  it('loads only exact performance calls and transcripts', async () => {
    const filters: Record<string, [string, unknown][]> = {};
    const rows: Record<string, unknown[]> = {
      leads: [{ id: 'lead-1', opener_hint: 'Warm lead' }],
      calls: [{ id: 'call-1', lead_id: 'lead-1', outcome: 'interested', started_at: '2026-06-01T12:00:00.000Z' }],
      followups: [],
      coaching_events: [],
      playbook_versions: [],
      transcripts: [{ outcome: 'booked' }],
    };
    const from = vi.fn((table: string) => {
      filters[table] = [];
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters[table].push([column, value]);
          return builder;
        },
        in: () => builder,
        gte: () => builder,
        lte: () => builder,
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve),
      };
      return builder;
    });

    const result = await loadStatsInputs({ from } as unknown as SupabaseClient, {
      verticalId: 'vertical-1',
      verticalSlug: 'holiday',
      from: '2026-06-01',
      to: '2026-06-02',
    });

    expect(result.ok).toBe(true);
    expect(filters.calls).toContainEqual(['metric_scope', 'performance']);
    expect(filters.transcripts).toContainEqual(['metric_scope', 'performance']);
  });
});

describe('topNoiseCardTexts', () => {
  it('counts only noise-rated events, deduped case-insensitively, most-repeated first', () => {
    const result = topNoiseCardTexts([
      { cardText: 'Ask about referral', repRating: 'helpful' },
      { cardText: 'Ask about referral', repRating: 'noise' },
      { cardText: 'Mention warranty', repRating: 'noise' },
      { cardText: 'mention warranty', repRating: 'noise' },
      { cardText: 'Something else', repRating: null },
    ]);
    expect(result).toEqual([
      { text: 'Mention warranty', count: 2 },
      { text: 'Ask about referral', count: 1 },
    ]);
  });

  it('caps at the given limit', () => {
    const events = ['a', 'b', 'c'].map(t => ({ cardText: t, repRating: 'noise' as const }));
    expect(topNoiseCardTexts(events, 2)).toHaveLength(2);
  });

  it('returns an empty array with no noise-rated events', () => {
    expect(topNoiseCardTexts([{ cardText: 'x', repRating: 'helpful' }])).toEqual([]);
  });
});

describe('date range / period boundary logic', () => {
  const now = new Date('2026-07-15T12:00:00.000Z');

  describe('parseDateRange', () => {
    it('keeps a valid explicit range', () => {
      expect(parseDateRange('2026-06-01', '2026-06-30', now)).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    });

    it('defaults to the last 30 days when both are missing', () => {
      expect(parseDateRange(null, null, now)).toEqual({ from: '2026-06-15', to: '2026-07-15' });
    });

    it('falls back to the default for a malformed date', () => {
      expect(parseDateRange('not-a-date', '2026-07-10', now)).toEqual({ from: '2026-06-15', to: '2026-07-10' });
    });

    it('swaps a backwards range instead of erroring', () => {
      expect(parseDateRange('2026-07-10', '2026-07-01', now)).toEqual({ from: '2026-07-01', to: '2026-07-10' });
    });
  });

  describe('periodFromDays', () => {
    it('defaults to 7 days', () => {
      expect(periodFromDays(7, new Date('2026-07-08T00:00:00.000Z'))).toEqual({
        periodStart: '2026-07-01',
        periodEnd: '2026-07-08',
      });
    });

    it('defaults to 7 when given zero, negative, or NaN', () => {
      const expected = { periodStart: '2026-07-01', periodEnd: '2026-07-08' };
      const at = new Date('2026-07-08T00:00:00.000Z');
      expect(periodFromDays(0, at)).toEqual(expected);
      expect(periodFromDays(-3, at)).toEqual(expected);
      expect(periodFromDays(NaN, at)).toEqual(expected);
    });

    it('floors a fractional period', () => {
      expect(periodFromDays(2.9, new Date('2026-07-08T00:00:00.000Z'))).toEqual({
        periodStart: '2026-07-06',
        periodEnd: '2026-07-08',
      });
    });
  });

  describe('dateRangeToTimestamps', () => {
    it('produces inclusive whole-day UTC bounds', () => {
      expect(dateRangeToTimestamps('2026-06-01', '2026-06-03')).toEqual({
        startIso: '2026-06-01T00:00:00.000Z',
        endIso: '2026-06-03T23:59:59.999Z',
      });
    });
  });
});

describe('computeStats', () => {
  const fixture: StatsInputs = {
    from: '2026-06-01',
    to: '2026-06-03',
    calls: [
      { id: 'c1', outcome: 'interested', startedAt: '2026-06-01T10:00:00.000Z', openerHint: 'Inbound follow-up' },
      { id: 'c2', outcome: 'voicemail', startedAt: '2026-06-01T11:00:00.000Z', openerHint: 'Inbound follow-up' },
      { id: 'c3', outcome: 'not_interested', startedAt: '2026-06-02T09:00:00.000Z', openerHint: 'Past customer' },
      { id: 'c4', outcome: null, startedAt: '2026-06-02T09:30:00.000Z', openerHint: null },
      { id: 'c5', outcome: 'interested', startedAt: '2026-06-03T14:00:00.000Z', openerHint: 'Past customer' },
    ],
    followups: [{ status: 'approved_sent' }, { status: 'draft' }, { status: 'approved_sent' }, { status: 'failed' }],
    coachingEvents: [
      { cardText: 'Ask about referral', repRating: 'helpful' },
      { cardText: 'Ask about referral', repRating: 'noise' },
      { cardText: 'Mention warranty', repRating: 'noise' },
      { cardText: 'Mention warranty', repRating: 'noise' },
      { cardText: 'Something else', repRating: null },
    ],
    playbookVersions: [
      { version: 1, createdAt: '2026-05-01T00:00:00.000Z' },
      { version: 2, createdAt: '2026-06-02T00:00:00.000Z' },
    ],
    transcripts: [{ outcome: 'booked' }, { outcome: 'booked' }, { outcome: 'not_booked' }, { outcome: 'unknown' }],
  };

  it('produces the exact aggregate for the fixture', () => {
    expect(computeStats(fixture)).toEqual({
      from: '2026-06-01',
      to: '2026-06-03',
      totalCalls: 5,
      callsByOutcome: {
        interested: 2,
        callback: 0,
        not_interested: 1,
        wrong_number: 0,
        voicemail: 1,
        no_answer: 0,
      },
      noOutcomeCalls: 1,
      connectRate: 60,
      interestedCount: 2,
      interestedRate: 40,
      byOpener: [
        { openerHint: 'Inbound follow-up', calls: 2, interested: 1, interestedRate: 50 },
        { openerHint: 'Past customer', calls: 2, interested: 1, interestedRate: 50 },
        { openerHint: '(none)', calls: 1, interested: 0, interestedRate: 0 },
      ],
      byVersion: [
        { version: 1, calls: 2, interested: 1, interestedRate: 50 },
        { version: 2, calls: 3, interested: 1, interestedRate: 33.3 },
      ],
      followupsSent: 2,
      coaching: { helpful: 1, noise: 3, helpfulRate: 25 },
      transcripts: { booked: 2, notBooked: 1, unknown: 1, total: 4 },
      trend: [
        { date: '2026-06-01', calls: 2 },
        { date: '2026-06-02', calls: 2 },
        { date: '2026-06-03', calls: 1 },
      ],
    });
  });

  it('degrades to zeroes instead of NaN with no calls at all', () => {
    const empty: StatsInputs = {
      from: '2026-06-01',
      to: '2026-06-01',
      calls: [],
      followups: [],
      coachingEvents: [],
      playbookVersions: [],
      transcripts: [],
    };
    const result = computeStats(empty);
    expect(result.totalCalls).toBe(0);
    expect(result.connectRate).toBe(0);
    expect(result.interestedRate).toBe(0);
    expect(result.byOpener).toEqual([]);
    expect(result.byVersion).toEqual([]);
    expect(result.coaching).toEqual({ helpful: 0, noise: 0, helpfulRate: 0 });
    expect(result.trend).toEqual([{ date: '2026-06-01', calls: 0 }]);
  });
});
