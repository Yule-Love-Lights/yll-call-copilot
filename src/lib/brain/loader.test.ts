import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadBrainView } from './loader';

describe('Brain metric provenance', () => {
  it('drops learnings whose transcript is not in the performance transcript set', async () => {
    const filters: Record<string, [string, unknown][]> = {};
    const dataByTable: Record<string, unknown[]> = {
      verticals: [],
      documents: [],
      learnings: [
        { transcript_id: 'real', objections: [], customer_language: [], what_worked: ['Real discovery'], what_failed: [], extracted_at: '2026-07-02T00:00:00Z' },
        { transcript_id: 'training', objections: [], customer_language: [], what_worked: ['Scripted simulator line'], what_failed: [], extracted_at: '2026-07-03T00:00:00Z' },
      ],
      transcripts: [{ id: 'real', vertical_id: null, outcome: 'booked' }],
      brain_insights: [],
      call_scores: [],
    };
    const from = vi.fn((table: string) => {
      filters[table] = [];
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters[table].push([column, value]);
          return builder;
        },
        then: (resolve: (value: { data: unknown[]; error: null; count?: number }) => unknown) =>
          Promise.resolve({ data: dataByTable[table] ?? [], error: null, count: table === 'playbook_proposals' ? 0 : undefined }).then(resolve),
      };
      return builder;
    });

    const result = await loadBrainView({ from } as unknown as SupabaseClient);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected Brain load to succeed');
    expect(result.view.stats.transcriptsLearned).toBe(1);
    expect(result.view.coaching?.topWhatWorked).toEqual([{ item: 'Real discovery', count: 1 }]);
    expect(filters.transcripts).toContainEqual(['metric_scope', 'performance']);
    expect(filters.call_scores).toContainEqual(['metric_scope', 'performance']);
  });
});
