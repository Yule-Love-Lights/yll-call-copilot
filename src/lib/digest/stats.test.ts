// Coverage for the pure aggregation in src/lib/digest/stats.ts: the
// dimension leaderboard (incl. tie-break and rows missing some dimensions),
// team + per-rep averages with week-over-week deltas, guarantee say-rates
// (incl. the applicable=0 -> n/a path), best call / roughest moment
// selection, and the empty-week path. Fixture rows only, no Supabase --
// same convention as src/lib/analytics/stats.test.ts.

import { describe, it, expect } from 'vitest';
import {
  bestCall,
  computeDigestStats,
  dimensionLeaderboard,
  guaranteeSayRates,
  lowestDimensions,
  repAverages,
  roughestMoment,
  teamAverages,
  type CallScoreRow,
} from './stats';

function row(overrides: Partial<CallScoreRow> & { id: string }): CallScoreRow {
  return {
    repEmail: 'rep@yulelovelights.com',
    overall: 70,
    experienceScore: 7,
    win: null,
    fix: null,
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
      dead_air: { score: 8, max: 10 },
      warm_ending: { score: 8, max: 10 },
    },
    guarantees: null,
    ...overrides,
  };
}

describe('dimensionLeaderboard / lowestDimensions', () => {
  it('averages each dimension as a percent and sorts ascending', () => {
    const rows = [
      row({ id: '1', emotional: { state: 'busy', namedBack: true, matchedTrack: true, grade: 5, notes: null } }),
      row({ id: '2', emotional: { state: 'busy', namedBack: true, matchedTrack: true, grade: 9, notes: null } }),
    ];
    const board = dimensionLeaderboard(rows);
    const emotional = board.find(d => d.key === 'emotional_match')!;
    expect(emotional.avgRatio).toBe(70); // (5+9)/2 = 7 -> 7/10 = 70%
    expect(emotional.calls).toBe(2);
    // ascending order
    for (let i = 1; i < board.length; i++) {
      expect(board[i].avgRatio).toBeGreaterThanOrEqual(board[i - 1].avgRatio);
    }
  });

  it('ties break alphabetically by dimension key', () => {
    // Every dimension scores identically (50%) across a single row, so every
    // dimension ties -- the whole leaderboard order collapses to alphabetical.
    const flat: CallScoreRow = row({
      id: '1',
      emotional: { state: 'guarded', namedBack: true, matchedTrack: false, grade: 5, notes: null },
      sales: {
        opening: { score: 5, max: 10 },
        discovery: { score: 5, max: 10 },
        value: { score: 5, max: 10 },
        objections: { score: 5, max: 10 },
        close: { score: 5, max: 10 },
      },
      hospitality: {
        greeting: { score: 5, max: 10 },
        listening: { score: 5, max: 10 },
        courtesy: { score: 5, max: 10 },
        dead_air: { score: 5, max: 10 },
        warm_ending: { score: 5, max: 10 },
      },
    });
    const board = dimensionLeaderboard([flat]);
    const keys = board.map(d => d.key);
    const sortedKeys = [...keys].sort((a, b) => a.localeCompare(b));
    expect(keys).toEqual(sortedKeys);
  });

  it('skips rows missing a given dimension rather than counting them as 0', () => {
    const rows = [
      row({ id: '1', hospitality: { greeting: { score: 9, max: 10 } } }), // dead_air missing
      row({ id: '2', hospitality: { greeting: { score: 9, max: 10 }, dead_air: { score: 2, max: 10 } } }),
    ];
    const board = dimensionLeaderboard(rows);
    const deadAir = board.find(d => d.key === 'hospitality_dead_air')!;
    // Only row 2 contributes -- if row 1's absence were treated as 0 the
    // average would be (0+2)/2=10%, not row 2's own 20%.
    expect(deadAir.calls).toBe(1);
    expect(deadAir.avgRatio).toBe(20);
  });

  it('excludes a dimension entirely when no row recorded it', () => {
    const rows = [row({ id: '1', sales: null })];
    const board = dimensionLeaderboard(rows);
    expect(board.some(d => d.key.startsWith('sales_'))).toBe(false);
  });

  it('lowestDimensions returns the 3 worst, fewer if fewer than 3 have data', () => {
    const rows = [row({ id: '1', sales: null, hospitality: null })]; // only emotional_match has data
    expect(lowestDimensions(rows)).toHaveLength(1);
  });

  it('returns an empty leaderboard for an empty week', () => {
    expect(dimensionLeaderboard([])).toEqual([]);
  });
});

describe('teamAverages', () => {
  it('averages overall and experience across all reps', () => {
    const rows = [
      row({ id: '1', repEmail: 'a@yll.com', overall: 80, experienceScore: 8 }),
      row({ id: '2', repEmail: 'b@yll.com', overall: 60, experienceScore: 6 }),
    ];
    expect(teamAverages(rows)).toEqual({ calls: 2, reps: 2, avgOverall: 70, avgExperience: 7 });
  });

  it('handles an empty week honestly (null averages, not 0)', () => {
    expect(teamAverages([])).toEqual({ calls: 0, reps: 0, avgOverall: null, avgExperience: null });
  });
});

describe('repAverages (week-over-week deltas)', () => {
  it('computes each rep\'s delta against their own prior-week average', () => {
    const thisWeek = [
      row({ id: '1', repEmail: 'a@yll.com', overall: 80, experienceScore: 8 }),
      row({ id: '2', repEmail: 'a@yll.com', overall: 90, experienceScore: 9 }),
    ];
    const lastWeek = [row({ id: '0', repEmail: 'a@yll.com', overall: 70, experienceScore: 7 })];
    const result = repAverages(thisWeek, lastWeek);
    expect(result).toEqual([{ repEmail: 'a@yll.com', calls: 2, avgOverall: 85, avgExperience: 8.5, deltaOverall: 15, deltaExperience: 1.5 }]);
  });

  it('returns a null delta when the rep has no prior-week calls', () => {
    const thisWeek = [row({ id: '1', repEmail: 'new@yll.com', overall: 80, experienceScore: 8 })];
    const result = repAverages(thisWeek, []);
    expect(result[0].deltaOverall).toBeNull();
    expect(result[0].deltaExperience).toBeNull();
  });

  it('sorts reps alphabetically by email', () => {
    const thisWeek = [
      row({ id: '1', repEmail: 'z@yll.com' }),
      row({ id: '2', repEmail: 'a@yll.com' }),
    ];
    expect(repAverages(thisWeek, []).map(r => r.repEmail)).toEqual(['a@yll.com', 'z@yll.com']);
  });
});

describe('guaranteeSayRates', () => {
  it('computes done/applicable as a percent', () => {
    const rows = [
      row({ id: '1', guarantees: { fast_fix_48h: { applicable: true, done: true } } }),
      row({ id: '2', guarantees: { fast_fix_48h: { applicable: true, done: false } } }),
    ];
    const rate = guaranteeSayRates(rows).find(g => g.key === 'fast_fix_48h')!;
    expect(rate).toEqual({ key: 'fast_fix_48h', label: '48-hour fast-fix guarantee', done: 1, applicable: 2, rate: 50 });
  });

  it('returns a null rate (not 0, not divide-by-zero) when never applicable', () => {
    const rows = [row({ id: '1', guarantees: { fast_fix_48h: { applicable: false, done: false } } })];
    const rate = guaranteeSayRates(rows).find(g => g.key === 'fast_fix_48h')!;
    expect(rate.applicable).toBe(0);
    expect(rate.rate).toBeNull();
  });

  it('treats a missing guarantees object as not applicable', () => {
    const rows = [row({ id: '1', guarantees: null })];
    const rate = guaranteeSayRates(rows).find(g => g.key === 'referral_ask')!;
    expect(rate.rate).toBeNull();
  });
});

describe('bestCall / roughestMoment', () => {
  it('picks the highest-overall call as best', () => {
    const rows = [
      row({ id: '1', overall: 70, win: 'Booked a 3-house block.' }),
      row({ id: '2', overall: 95, win: 'Closed on the first call.' }),
    ];
    expect(bestCall(rows)).toEqual({ id: '2', repEmail: 'rep@yulelovelights.com', overall: 95, win: 'Closed on the first call.' });
  });

  it('picks the lowest-overall call that has a fix as roughest', () => {
    const fix = { moment: 'Price stated cold', timestampSeconds: 90, transcriptQuote: '...', betterLine: 'Value first, then the number.' };
    const rows = [
      row({ id: '1', overall: 40 }), // low score but no fix -- not eligible
      row({ id: '2', overall: 55, fix }),
      row({ id: '3', overall: 80, fix: { ...fix, moment: 'different' } }),
    ];
    const result = roughestMoment(rows);
    expect(result?.id).toBe('2');
    expect(result?.fix).toEqual(fix);
  });

  it('returns null for best/roughest on an empty week', () => {
    expect(bestCall([])).toBeNull();
    expect(roughestMoment([])).toBeNull();
  });

  it('returns null roughest when no call recorded a fix, even with calls present', () => {
    const rows = [row({ id: '1', overall: 40, fix: null })];
    expect(roughestMoment(rows)).toBeNull();
  });
});

describe('computeDigestStats (empty week)', () => {
  it('produces an honest all-empty result with no scored calls', () => {
    const stats = computeDigestStats({ periodStart: '2026-07-06', periodEnd: '2026-07-12', thisWeek: [], lastWeek: [] });
    expect(stats.team).toEqual({ calls: 0, reps: 0, avgOverall: null, avgExperience: null });
    expect(stats.reps).toEqual([]);
    expect(stats.lowestDimensions).toEqual([]);
    expect(stats.bestCall).toBeNull();
    expect(stats.roughestMoment).toBeNull();
    expect(stats.guarantees.every(g => g.rate === null)).toBe(true);
  });
});
