// Coverage for the FIX 2 regression: call_scores.fix/emotional are snake_case
// jsonb ({ timestamp_seconds, transcript_quote, better_line } /
// { named_back, matched_track }), but mapRow used to pass them straight
// through, so DigestView rendered "NaN:NaN" and a blank quote/better-line.
// Raw rows here use the REAL snake_case DB shape; assertions check the
// mapped camelCase result. Supabase-loader tests follow the fake-client
// style of src/lib/leads/queue.test.ts.

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mapRow, loadCallScoreRows } from './loadCallScores';

function rawDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'call-1',
    rep_email: 'rep@yulelovelights.com',
    overall: 72,
    experience_score: 7,
    win: null,
    fix: {
      moment: 'Price stated cold',
      timestamp_seconds: 125,
      transcript_quote: 'That is more than I wanted to spend.',
      better_line: 'Stack the value before the number.',
    },
    emotional: {
      state: 'guarded',
      named_back: true,
      matched_track: false,
      grade: 6,
      notes: 'Ran proof-and-guarantees late.',
    },
    sales: null,
    hospitality: null,
    guarantees: null,
    ...overrides,
  };
}

describe('mapRow (snake_case DB row -> camelCase CallScoreRow)', () => {
  it('maps fix from snake_case to camelCase with no NaN timestamp', () => {
    const mapped = mapRow(rawDbRow());

    expect(mapped.fix).toEqual({
      moment: 'Price stated cold',
      timestampSeconds: 125,
      transcriptQuote: 'That is more than I wanted to spend.',
      betterLine: 'Stack the value before the number.',
    });

    // The regression: timestampSeconds must be a real number so a real
    // mm:ss renders, never NaN:NaN (a raw row's nested timestamp_seconds
    // passed straight through as `undefined` would have produced this).
    expect(Number.isNaN(mapped.fix!.timestampSeconds)).toBe(false);
    const m = Math.floor(mapped.fix!.timestampSeconds / 60);
    const s = Math.floor(mapped.fix!.timestampSeconds % 60);
    expect(`${m}:${s.toString().padStart(2, '0')}`).toBe('2:05');
  });

  it('maps emotional from snake_case to camelCase, including the boolean matched_track', () => {
    const mapped = mapRow(rawDbRow());

    expect(mapped.emotional).toEqual({
      state: 'guarded',
      namedBack: true,
      matchedTrack: false,
      grade: 6,
      notes: 'Ran proof-and-guarantees late.',
    });
  });

  it('passes null fix/emotional through as null (no scored fix/emotional this call)', () => {
    const mapped = mapRow(rawDbRow({ fix: null, emotional: null }));
    expect(mapped.fix).toBeNull();
    expect(mapped.emotional).toBeNull();
  });

  it('defaults a missing emotional.notes to null rather than undefined', () => {
    const mapped = mapRow(
      rawDbRow({ emotional: { state: 'excited', named_back: true, matched_track: true, grade: 9 } }),
    );
    expect(mapped.emotional!.notes).toBeNull();
  });
});

describe('loadCallScoreRows (Supabase loader, mapRow wired end to end)', () => {
  function fakeClient(rows: Record<string, unknown>[]) {
    const eqCalls: [string, unknown][] = [];
    const from = vi.fn(() => ({
      select: () => ({
        eq: (column: string, value: unknown) => {
          eqCalls.push([column, value]);
          return {
            gte: () => ({
              lte: () => Promise.resolve({ data: rows, error: null }),
            }),
          };
        },
      }),
    }));
    return { client: { from } as unknown as SupabaseClient, eqCalls };
  }

  it('returns rows with the fix moment mapped to camelCase, ready to format a real timestamp', async () => {
    const { client, eqCalls } = fakeClient([rawDbRow()]);
    const result = await loadCallScoreRows(client, '2026-07-06', '2026-07-12');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].fix?.timestampSeconds).toBe(125);
    expect(result.rows[0].fix?.transcriptQuote).toBe('That is more than I wanted to spend.');
    expect(result.rows[0].emotional?.matchedTrack).toBe(false);
    expect(eqCalls).toEqual([['metric_scope', 'performance']]);
  });
});
