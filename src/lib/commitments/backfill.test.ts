// Coverage for backfillCommitments -- the batch entry point that lets
// existing transcripts be run through the extractor. Mocks extraction and
// persistence the same way process.test.ts mocks extractLearnings; no live
// Supabase/Claude calls. #217

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const extractRawCommitmentsMock = vi.fn();
vi.mock('./extract', () => ({
  extractRawCommitments: (...args: unknown[]) => extractRawCommitmentsMock(...args),
}));

const persistCommitmentsMock = vi.fn();
vi.mock('./persist', () => ({
  persistCommitments: (...args: unknown[]) => persistCommitmentsMock(...args),
}));

import { backfillCommitments, selectBackfillCandidates } from './backfill';
import type { BackfillCandidate } from './backfill';

function fakeSupabase(transcripts: BackfillCandidate[], existingTranscriptIds: string[] = []) {
  const from = vi.fn((table: string) => {
    if (table === 'transcripts') {
      return {
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: transcripts, error: null }),
          }),
        }),
      };
    }
    if (table === 'call_commitments') {
      return {
        select: () => ({
          in: () => Promise.resolve({ data: existingTranscriptIds.map(id => ({ transcript_id: id })), error: null }),
        }),
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });
  return { from } as unknown as SupabaseClient;
}

const t1: BackfillCandidate = { id: 't1', raw_text: 'Rep: hi.', called_at: '2026-01-15T18:30:00Z', rep_email: 'rep@x.com', ghl_contact_id: 'g1' };
const t2: BackfillCandidate = { id: 't2', raw_text: 'Rep: hello.', called_at: '2026-01-14T18:30:00Z', rep_email: null, ghl_contact_id: null };

describe('selectBackfillCandidates', () => {
  it('drops candidates that already have a commitment row, keeps the rest, caps at limit', () => {
    const result = selectBackfillCandidates([t1, t2], new Set(['t1']), 10);
    expect(result).toEqual([t2]);
  });

  it('caps at limit even when nothing has been extracted yet', () => {
    const result = selectBackfillCandidates([t1, t2], new Set(), 1);
    expect(result).toEqual([t1]);
  });
});

describe('backfillCommitments', () => {
  beforeEach(() => {
    extractRawCommitmentsMock.mockReset().mockResolvedValue([]);
    persistCommitmentsMock.mockReset().mockResolvedValue(undefined);
  });

  it('extracts and persists for each candidate transcript not already processed', async () => {
    const supabase = fakeSupabase([t1, t2], ['t1']);

    const result = await backfillCommitments(supabase, 'Holiday Lighting', 10);

    expect(extractRawCommitmentsMock).toHaveBeenCalledTimes(1);
    expect(extractRawCommitmentsMock).toHaveBeenCalledWith(t2.raw_text, 'Holiday Lighting');
    expect(persistCommitmentsMock).toHaveBeenCalledTimes(1);
    expect(persistCommitmentsMock).toHaveBeenCalledWith(supabase, 't2', null, null, []);
    expect(result).toEqual({ done: 1, skipped: 0, failed: 0 });
  });

  it('a transcript with zero commitments still counts as done, not failed', async () => {
    extractRawCommitmentsMock.mockResolvedValue([]);
    const supabase = fakeSupabase([t1]);

    const result = await backfillCommitments(supabase, 'Holiday Lighting', 10);

    expect(result).toEqual({ done: 1, skipped: 0, failed: 0 });
  });

  it('counts a failed extraction without stopping the batch', async () => {
    extractRawCommitmentsMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce([]);
    const supabase = fakeSupabase([t1, t2]);

    const result = await backfillCommitments(supabase, 'Holiday Lighting', 10);

    expect(result).toEqual({ done: 1, skipped: 0, failed: 1 });
  });

  it('returns all-zero when there are no candidate transcripts', async () => {
    const supabase = fakeSupabase([]);

    const result = await backfillCommitments(supabase, 'Holiday Lighting', 10);

    expect(result).toEqual({ done: 0, skipped: 0, failed: 0 });
  });
});
