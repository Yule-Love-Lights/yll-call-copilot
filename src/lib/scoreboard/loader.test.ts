import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCallScores } from './loader';

describe('scoreboard call-score provenance', () => {
  it('positive-filters performance before applying an optional rep filter', async () => {
    const eqCalls: [string, unknown][] = [];
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        eqCalls.push([column, value]);
        return builder;
      },
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    };
    const client = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    const result = await loadCallScores(client, { repEmail: 'rep@yulelovelights.com' });

    expect(result).toEqual({ ok: true, rows: [] });
    expect(eqCalls).toEqual([
      ['metric_scope', 'performance'],
      ['rep_email', 'rep@yulelovelights.com'],
    ]);
  });
});
