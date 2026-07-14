// Coverage for materializeFeedbackCards -- the lazy-on-read step that is
// this workstream's substitute for a cron: GET /api/feedback calls this
// before reading the feed so a card exists "minutes after each call" with no
// scheduled job. Style follows leads/queue.test.ts -- a hand-rolled fake
// Supabase client, no live database.

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { materializeFeedbackCards } from './materialize';
import type { CallScoreRow } from './types';

function score(id: string, overrides: Partial<CallScoreRow> = {}): CallScoreRow {
  return {
    id,
    transcript_id: `transcript-${id}`,
    rubric_version: 1,
    rep_email: 'jason@example.com',
    vertical_slug: 'holiday',
    called_at: '2026-07-10T18:00:00.000Z',
    emotional: { state: 'excited', named_back: true, matched_track: true, grade: 9, notes: '' },
    sales: {
      opening: { score: 14, max: 15, notes: '' },
      discovery: { score: 20, max: 25, notes: '' },
      value: { score: 18, max: 20, notes: '' },
      objections: { score: 16, max: 20, notes: '' },
      close: { score: 18, max: 20, notes: '' },
      total: 86,
    },
    hospitality: {
      greeting: { score: 9, max: 10, notes: '' },
      listening: { score: 10, max: 10, notes: '' },
      courtesy: { score: 9, max: 10, notes: '' },
      dead_air: { score: 8, max: 10, notes: '' },
      warm_ending: { score: 10, max: 10, notes: '' },
      total: 46,
    },
    hard_metrics: {
      rep_talk_ratio: 0.44,
      question_count: 6,
      dead_air_seconds: 12,
      interruption_count: 0,
      duration_seconds: 540,
    },
    experience: { cared_for: 9, at_ease: 8, excited: 9, notes: '' },
    experience_score: 95,
    guarantees: {},
    overall: 87,
    win: 'You named her excitement back before pitching a single thing.',
    fix: null,
    scored_at: '2026-07-10T18:12:00.000Z',
    ...overrides,
  };
}

// Minimal chainable fake covering exactly the calls materializeFeedbackCards
// makes: call_scores.select().eq(), feedback_cards.select().in(), and
// feedback_cards.upsert().
function fakeClient(opts: {
  scores: CallScoreRow[];
  existingCallScoreIds: string[];
  upsertError?: unknown;
}) {
  const upsertCalls: { rows: unknown[]; options: unknown }[] = [];

  const from = vi.fn((table: string) => {
    if (table === 'call_scores') {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: opts.scores, error: null }),
        }),
      };
    }
    if (table === 'feedback_cards') {
      return {
        select: () => ({
          in: () =>
            Promise.resolve({
              data: opts.existingCallScoreIds.map(call_score_id => ({ call_score_id })),
              error: null,
            }),
        }),
        upsert: (rows: unknown[], options: unknown) => {
          upsertCalls.push({ rows, options });
          return Promise.resolve({ error: opts.upsertError ?? null });
        },
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  const client = { from } as unknown as SupabaseClient;
  return { client, upsertCalls };
}

describe('materializeFeedbackCards', () => {
  it('creates a feedback_cards row for every call_score missing one', async () => {
    const { client, upsertCalls } = fakeClient({
      scores: [score('s1'), score('s2', { fix: { moment: 'm', timestamp_seconds: 10, transcript_quote: 'q', better_line: 'b' } })],
      existingCallScoreIds: [],
    });

    const result = await materializeFeedbackCards(client, 'jason@example.com');

    expect(result.created).toBe(2);
    expect(upsertCalls).toHaveLength(1);
    const rows = upsertCalls[0].rows as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ call_score_id: 's1', rep_email: 'jason@example.com', praise_only: true });
    expect(rows[1]).toMatchObject({ call_score_id: 's2', praise_only: false });
    // The upsert must be conflict-safe on call_score_id -- see the idempotent
    // test below for why.
    expect(upsertCalls[0].options).toMatchObject({ onConflict: 'call_score_id', ignoreDuplicates: true });
  });

  it('is idempotent -- skips call_scores that already have a feedback_cards row', async () => {
    const { client, upsertCalls } = fakeClient({
      scores: [score('s1'), score('s2')],
      existingCallScoreIds: ['s1', 's2'],
    });

    const result = await materializeFeedbackCards(client, 'jason@example.com');

    expect(result.created).toBe(0);
    expect(upsertCalls).toHaveLength(0);
  });

  it('only materializes the missing subset when some call_scores already have a card', async () => {
    const { client, upsertCalls } = fakeClient({
      scores: [score('s1'), score('s2')],
      existingCallScoreIds: ['s1'],
    });

    const result = await materializeFeedbackCards(client, 'jason@example.com');

    expect(result.created).toBe(1);
    const rows = upsertCalls[0].rows as Record<string, unknown>[];
    expect(rows).toEqual([expect.objectContaining({ call_score_id: 's2' })]);
  });

  it('does not throw when a concurrent request already inserted the same card (unique-violation-shaped upsert error is swallowed as a race, not surfaced)', async () => {
    const { client } = fakeClient({
      scores: [score('s1')],
      existingCallScoreIds: [],
      upsertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });

    // ignoreDuplicates already makes Postgres itself a no-op on conflict, so
    // in real use upsertError would never carry 23505 -- this asserts the
    // belt-and-braces case: even if it somehow does, materialize does not
    // throw and does not 500 the caller.
    await expect(materializeFeedbackCards(client, 'jason@example.com')).resolves.toEqual({ created: 1 });
  });

  it('rethrows a genuine (non-race) upsert error', async () => {
    const { client } = fakeClient({
      scores: [score('s1')],
      existingCallScoreIds: [],
      upsertError: { code: '42501', message: 'permission denied' },
    });

    await expect(materializeFeedbackCards(client, 'jason@example.com')).rejects.toMatchObject({ code: '42501' });
  });

  it('does nothing when the rep has no call_scores at all', async () => {
    const { client, upsertCalls } = fakeClient({ scores: [], existingCallScoreIds: [] });
    const result = await materializeFeedbackCards(client, 'jason@example.com');
    expect(result.created).toBe(0);
    expect(upsertCalls).toHaveLength(0);
  });
});
