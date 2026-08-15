import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeInsights } from './insights';

describe('computeInsights metric provenance', () => {
  it('uses only performance transcript ids when loading learnings', async () => {
    const filters: Record<string, [string, unknown][]> = { transcripts: [], learnings: [] };
    const inCalls: [string, unknown[]][] = [];
    const from = vi.fn((table: string) => {
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters[table].push([column, value]);
          return builder;
        },
        in: (column: string, values: unknown[]) => {
          inCalls.push([column, values]);
          return builder;
        },
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({
            data: table === 'transcripts'
              ? [{ id: 'real-transcript', outcome: 'booked' }]
              : [{ objections: [], customer_language: [], what_worked: ['Asked discovery questions'], what_failed: [], price_talk: [], questions: [] }],
            error: null,
          }).then(resolve),
      };
      return builder;
    });

    const result = await computeInsights({ from } as unknown as SupabaseClient, 'vertical-1');

    expect(result.ok).toBe(true);
    expect(filters.transcripts).toContainEqual(['metric_scope', 'performance']);
    expect(inCalls).toEqual([['transcript_id', ['real-transcript']]]);
  });
});
