// Coverage for processTranscriptBatch — focused on the H5 regression: a
// retried batch (the same transcript id processed twice, e.g. after a
// timeout/crash mid-batch re-drives it through /api/ingest/continue) must
// not insert a second `learnings` row for that transcript. The write is now
// an upsert keyed on the new unique(transcript_id) constraint (see
// supabase/migrations/0003_knowledge.sql), not a bare insert. Mocks Claude
// extraction and the GHL client the same way other lib tests mock their
// dependencies — no live Supabase/Claude/GHL calls.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('../claude', () => ({ isClaudeConfigured: () => true }));

const extractLearningsMock = vi.fn();
vi.mock('./extract', () => ({
  extractLearnings: (...args: unknown[]) => extractLearningsMock(...args),
}));

vi.mock('../ghl/client', () => ({
  isHighLevelConfigured: () => false,
  getStageNameMap: vi.fn(async () => new Map()),
}));

import { processTranscriptBatch } from './process';

type UpsertCall = { row: Record<string, unknown>; options?: Record<string, unknown> };

function fakeSupabase() {
  const upsertCalls: UpsertCall[] = [];
  const upsert = vi.fn((row: Record<string, unknown>, options?: Record<string, unknown>) => {
    upsertCalls.push({ row, options });
    return Promise.resolve({ error: null });
  });
  const maybeSingle = vi.fn(() =>
    Promise.resolve({
      data: { id: 't1', raw_text: 'Rep: hi. Customer: hello.', customer_name: null, customer_phone: null },
      error: null,
    }),
  );
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn((table: string) => {
    if (table === 'learnings') return { upsert };
    if (table === 'transcripts') return { select, update: () => ({ eq: () => Promise.resolve({ error: null }) }) };
    throw new Error(`Unexpected table in test: ${table}`);
  });
  return { client: { from } as unknown as SupabaseClient, upsertCalls };
}

const sampleLearnings = {
  objections: [],
  customer_language: [],
  what_worked: [],
  what_failed: [],
  price_talk: [],
  questions: [],
  summary: 'summary',
};

describe('processTranscriptBatch — learnings idempotency (H5)', () => {
  beforeEach(() => {
    extractLearningsMock.mockReset().mockResolvedValue(sampleLearnings);
  });

  it('upserts on transcript_id instead of a bare insert', async () => {
    const { client, upsertCalls } = fakeSupabase();

    await processTranscriptBatch({
      supabase: client,
      transcriptIds: ['t1'],
      verticalId: 'v1',
      verticalName: 'Holiday Lighting',
      matchOutcomes: false,
    });

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].row).toMatchObject({ transcript_id: 't1', vertical_id: 'v1', summary: 'summary' });
    expect(upsertCalls[0].options).toEqual({ onConflict: 'transcript_id' });
  });

  it('processing the same transcript twice (a retried batch after a mid-batch crash) still only ever upserts, never a bare insert, so the DB unique(transcript_id) constraint keeps exactly one row', async () => {
    const { client, upsertCalls } = fakeSupabase();

    await processTranscriptBatch({ supabase: client, transcriptIds: ['t1'], verticalId: 'v1', verticalName: 'Holiday Lighting', matchOutcomes: false });
    await processTranscriptBatch({ supabase: client, transcriptIds: ['t1'], verticalId: 'v1', verticalName: 'Holiday Lighting', matchOutcomes: false });

    expect(upsertCalls).toHaveLength(2);
    for (const call of upsertCalls) {
      expect(call.row).toMatchObject({ transcript_id: 't1' });
      expect(call.options).toEqual({ onConflict: 'transcript_id' });
    }
  });

  it('still counts the transcript as done and reports zero failed', async () => {
    const { client } = fakeSupabase();

    const result = await processTranscriptBatch({
      supabase: client,
      transcriptIds: ['t1'],
      verticalId: 'v1',
      verticalName: 'Holiday Lighting',
      matchOutcomes: false,
    });

    expect(result).toEqual({ done: 1, failed: 0 });
  });
});
