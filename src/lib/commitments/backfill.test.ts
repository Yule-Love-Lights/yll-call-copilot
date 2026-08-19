// Coverage for backfillCommitments -- the batch entry point that lets
// existing transcripts be run through the extractor. Mocks extraction and
// persistence the same way process.test.ts mocks extractLearnings; no live
// Supabase/Claude calls. #217

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const extractRawCommitmentsMock = vi.fn();
vi.mock('./extract', () => ({
  extractRawCommitments: (...args: unknown[]) => extractRawCommitmentsMock(...args),
  EXTRACT_MODEL: 'test-extractor-v1',
  isTerminalCommitmentExtractionError: (error: unknown) =>
    error instanceof Error && error.name === 'TerminalCommitmentExtractionError',
}));

const persistCommitmentsMock = vi.fn();
vi.mock('./persist', () => ({
  persistCommitments: (...args: unknown[]) => persistCommitmentsMock(...args),
}));

import { backfillCommitments, selectBackfillCandidates } from './backfill';
import type { BackfillCandidate } from './backfill';

function fakeSupabase(transcripts: BackfillCandidate[]) {
  const scopeFilters: [string, unknown][] = [];
  const nullFilters: string[] = [];
  const rpc = vi.fn().mockResolvedValue({ data: 'retry_scheduled', error: null });
  const from = vi.fn((table: string) => {
    if (table === 'transcripts') {
      return {
        select: () => {
          let attemptFilter: 'fresh' | 'retry' | null = null;
          const query = {
            is(column: string) {
              nullFilters.push(column);
              if (column === 'commitment_extraction_last_attempt_at') attemptFilter = 'fresh';
              return query;
            },
            not(column: string) {
              if (column === 'commitment_extraction_last_attempt_at') attemptFilter = 'retry';
              return query;
            },
            eq(column: string, value: unknown) {
              scopeFilters.push([column, value]);
              return query;
            },
            order() {
              return query;
            },
            limit(value: number) {
              const filtered = transcripts.filter(candidate =>
                attemptFilter === 'retry'
                  ? candidate.commitment_extraction_last_attempt_at !== null
                  : attemptFilter === 'fresh'
                    ? candidate.commitment_extraction_last_attempt_at === null
                    : true);
              return Promise.resolve({ data: filtered.slice(0, value), error: null });
            },
          };
          return query;
        },
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });
  return {
    client: { from, rpc } as unknown as SupabaseClient,
    nullFilters,
    rpc,
    scopeFilters,
  };
}

const t1: BackfillCandidate = { id: 't1', raw_text: 'Rep: hi.', called_at: '2026-01-15T18:30:00Z', commitment_extraction_last_attempt_at: null, rep_email: 'rep@x.com', ghl_contact_id: 'g1', metric_scope: 'performance' };
const t2: BackfillCandidate = { id: 't2', raw_text: 'Rep: hello.', called_at: '2026-01-14T18:30:00Z', commitment_extraction_last_attempt_at: null, rep_email: null, ghl_contact_id: null, metric_scope: 'performance' };

describe('selectBackfillCandidates', () => {
  it('drops candidates that already have a commitment row, keeps the rest, caps at limit', () => {
    const result = selectBackfillCandidates([t1, t2], new Set(['t1']), 10);
    expect(result).toEqual([t2]);
  });

  it('caps at limit even when nothing has been extracted yet', () => {
    const result = selectBackfillCandidates([t1, t2], new Set(), 1);
    expect(result).toEqual([t2]);
  });

  it('reserves one retry slot while newer unattempted work continues', () => {
    const retry = {
      ...t1,
      id: 'retry',
      commitment_extraction_last_attempt_at: '2026-08-18T10:00:00Z',
    };
    const result = selectBackfillCandidates([retry, t1, t2], new Set(), 2);

    expect(result.map(candidate => candidate.id)).toEqual(['t2', 'retry']);
  });
});

describe('backfillCommitments', () => {
  beforeEach(() => {
    extractRawCommitmentsMock.mockReset().mockResolvedValue([]);
    persistCommitmentsMock.mockReset().mockResolvedValue({ ok: true, alreadyFinalized: false });
  });

  it('extracts and persists for each candidate transcript not already processed', async () => {
    const { client: supabase, scopeFilters } = fakeSupabase([t2]);

    const result = await backfillCommitments(supabase, 'Holiday Lighting', 10);

    expect(extractRawCommitmentsMock).toHaveBeenCalledTimes(1);
    expect(extractRawCommitmentsMock).toHaveBeenCalledWith(t2.raw_text, 'Holiday Lighting');
    expect(persistCommitmentsMock).toHaveBeenCalledTimes(1);
    expect(persistCommitmentsMock).toHaveBeenCalledWith(supabase, 't2', null, null, [], 'test-extractor-v1');
    expect(scopeFilters).toContainEqual(['metric_scope', 'performance']);
    expect(result).toEqual({ done: 1, skipped: 0, failed: 0, refused: 0, quarantined: 0 });
  });

  it('a transcript with zero commitments still counts as done, not failed', async () => {
    extractRawCommitmentsMock.mockResolvedValue([]);
    const { client: supabase } = fakeSupabase([t1]);

    const result = await backfillCommitments(supabase, 'Holiday Lighting', 10);

    expect(result).toEqual({ done: 1, skipped: 0, failed: 0, refused: 0, quarantined: 0 });
  });

  it('counts a failed extraction without stopping the batch', async () => {
    extractRawCommitmentsMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce([]);
    const { client: supabase, rpc } = fakeSupabase([t1, t2]);

    const result = await backfillCommitments(supabase, 'Holiday Lighting', 10);

    expect(rpc).toHaveBeenCalledWith('record_commitment_extraction_failure', {
      p_transcript_id: 't2',
      p_failure_code: 'transient_dependency_failed',
    });
    expect(result).toEqual({ done: 1, skipped: 0, failed: 1, refused: 0, quarantined: 0 });
  });

  it('counts a persist refusal separately from done/failed, without stopping the batch', async () => {
    persistCommitmentsMock
      .mockResolvedValueOnce({ ok: false, reason: 'has_resolved_commitments' })
      .mockResolvedValueOnce({ ok: true, alreadyFinalized: false });
    const { client: supabase } = fakeSupabase([t1, t2]);

    const result = await backfillCommitments(supabase, 'Holiday Lighting', 10);

    expect(result).toEqual({ done: 1, skipped: 0, failed: 0, refused: 1, quarantined: 0 });
  });

  it('counts a transcript finalized by a concurrent worker as skipped', async () => {
    persistCommitmentsMock.mockResolvedValueOnce({ ok: true, alreadyFinalized: true });
    const { client: supabase } = fakeSupabase([t1]);

    const result = await backfillCommitments(supabase, 'Holiday Lighting', 10);

    expect(result).toEqual({ done: 0, skipped: 1, failed: 0, refused: 0, quarantined: 0 });
  });

  it('returns all-zero when there are no candidate transcripts', async () => {
    const { client: supabase } = fakeSupabase([]);

    const result = await backfillCommitments(supabase, 'Holiday Lighting', 10);

    expect(result).toEqual({ done: 0, skipped: 0, failed: 0, refused: 0, quarantined: 0 });
  });

  it('rejects a non-performance row even if an upstream client returns it despite the query filter', async () => {
    const leakedTrainingRow = { ...t1, id: 'training-row', metric_scope: 'training' } as unknown as BackfillCandidate;
    const { client: supabase } = fakeSupabase([leakedTrainingRow]);

    const result = await backfillCommitments(supabase, 'Holiday Lighting', 10);

    expect(extractRawCommitmentsMock).not.toHaveBeenCalled();
    expect(persistCommitmentsMock).not.toHaveBeenCalled();
    expect(result).toEqual({ done: 0, skipped: 0, failed: 0, refused: 0, quarantined: 0 });
  });

  it('asks the database for only unprocessed transcripts so rows older than the newest 200 cannot starve', async () => {
    const oldUnprocessed = { ...t2, id: 'older-than-window' };
    const { client, nullFilters } = fakeSupabase([oldUnprocessed]);

    const result = await backfillCommitments(client, 'Holiday Lighting', 1);

    expect(nullFilters).toContain('commitments_extracted_at');
    expect(nullFilters).toContain('commitment_extraction_quarantined_at');
    expect(extractRawCommitmentsMock).toHaveBeenCalledWith(oldUnprocessed.raw_text, 'Holiday Lighting');
    expect(result.done).toBe(1);
  });

  it('quarantines only a deterministic extraction failure reported by the database', async () => {
    const terminal = new Error('invalid structured output');
    terminal.name = 'TerminalCommitmentExtractionError';
    extractRawCommitmentsMock.mockRejectedValue(terminal);
    const { client, rpc } = fakeSupabase([t1]);
    rpc.mockResolvedValue({ data: 'quarantined', error: null });

    const result = await backfillCommitments(client, 'Holiday Lighting', 1);

    expect(rpc).toHaveBeenCalledWith('record_commitment_extraction_failure', {
      p_transcript_id: 't1',
      p_failure_code: 'deterministic_extraction_failed',
    });
    expect(result).toEqual({ done: 0, skipped: 0, failed: 1, refused: 0, quarantined: 1 });
  });

  it('treats a success race as skipped instead of recording a false failure', async () => {
    extractRawCommitmentsMock.mockRejectedValue(new Error('temporary provider failure'));
    const { client, rpc } = fakeSupabase([t1]);
    rpc.mockResolvedValue({ data: 'already_finalized', error: null });

    const result = await backfillCommitments(client, 'Holiday Lighting', 1);

    expect(result).toEqual({ done: 0, skipped: 1, failed: 0, refused: 0, quarantined: 0 });
  });

  it('fails the whole job visibly when durable failure recording fails', async () => {
    extractRawCommitmentsMock.mockRejectedValue(new Error('temporary provider failure'));
    const { client, rpc } = fakeSupabase([t1]);
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });

    await expect(backfillCommitments(client, 'Holiday Lighting', 1)).rejects.toEqual({
      code: 'PGRST202',
    });
  });
});
