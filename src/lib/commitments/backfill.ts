// Backfill-capable entry point so existing transcripts can be processed
// through the commitment extractor -- same shared-batch-processor shape as
// src/lib/scoring/batch.ts's scoreNextBatch and src/lib/transcripts/
// process.ts's processTranscriptBatch. #217
//
// Migration 0024 adds durable transcript-level completion markers. They are
// required even when extraction finds zero commitments, and the database
// filters them before applying the batch limit so an older transcript cannot
// be hidden forever behind a full window of already-processed recent rows.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  extractRawCommitments,
  EXTRACT_MODEL,
  isTerminalCommitmentExtractionError,
} from './extract';
import { buildCommitmentRows } from './build';
import { persistCommitments } from './persist';

// Batch cap only. The database filters durable extraction markers BEFORE
// applying this bound, so processed recent transcripts cannot hide older work.
const CANDIDATE_WINDOW = 200;

export type BackfillCandidate = {
  id: string;
  raw_text: string;
  called_at: string | null;
  commitment_extraction_last_attempt_at: string | null;
  rep_email: string | null;
  ghl_contact_id: string | null;
  metric_scope: 'performance';
};

export type BackfillResult = {
  done: number;
  skipped: number;
  failed: number;
  refused: number;
  quarantined: number;
};

// Pure selection helper retained for callers/tests that already have a set of
// completed ids. The normal database path has filtered durable markers first.
export function selectBackfillCandidates(
  candidates: BackfillCandidate[],
  alreadyExtractedIds: ReadonlySet<string>,
  limit: number,
): BackfillCandidate[] {
  const eligible = candidates.filter(c => !alreadyExtractedIds.has(c.id));
  const byCallTime = (left: BackfillCandidate, right: BackfillCandidate) =>
    (left.called_at ?? '').localeCompare(right.called_at ?? '') || left.id.localeCompare(right.id);
  const fresh = eligible
    .filter(candidate => candidate.commitment_extraction_last_attempt_at === null)
    .sort(byCallTime);
  const retries = eligible
    .filter(candidate => candidate.commitment_extraction_last_attempt_at !== null)
    .sort((left, right) =>
      left.commitment_extraction_last_attempt_at!.localeCompare(
        right.commitment_extraction_last_attempt_at!,
      ) || byCallTime(left, right));

  // Reserve one slot for the oldest retry whenever one exists. New calls
  // therefore keep moving while a deterministic failure still reaches its
  // bounded third-attempt quarantine under steady transcript intake.
  const retrySlots = retries.length > 0 && limit > 0 ? 1 : 0;
  return [
    ...fresh.slice(0, Math.max(0, limit - retrySlots)),
    ...retries.slice(0, retrySlots),
  ];
}

export async function backfillCommitments(
  supabase: SupabaseClient,
  verticalName: string,
  limit: number,
): Promise<BackfillResult> {
  const batchLimit = Math.max(1, Math.min(limit, CANDIDATE_WINDOW));
  const selectColumns = 'id, raw_text, called_at, commitment_extraction_last_attempt_at, rep_email, ghl_contact_id, metric_scope';
  const retryQuery = supabase
    .from('transcripts')
    .select(selectColumns)
    .is('commitments_extracted_at', null)
    .is('commitment_extraction_quarantined_at', null)
    .eq('metric_scope', 'performance')
    .not('commitment_extraction_last_attempt_at', 'is', null)
    .order('commitment_extraction_last_attempt_at', { ascending: true })
    .order('called_at', { ascending: true, nullsFirst: true })
    .order('id', { ascending: true })
    .limit(1);
  const { data: retryRows, error: retryError } = await retryQuery;
  if (retryError) throw retryError;

  const retryCandidates = (retryRows ?? []) as BackfillCandidate[];
  const freshLimit = Math.max(0, batchLimit - Math.min(1, retryCandidates.length));
  let freshRows: BackfillCandidate[] = [];
  if (freshLimit > 0) {
    const { data, error } = await supabase
      .from('transcripts')
      .select(selectColumns)
      .is('commitments_extracted_at', null)
      .is('commitment_extraction_quarantined_at', null)
      .eq('metric_scope', 'performance')
      .is('commitment_extraction_last_attempt_at', null)
      .order('called_at', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .limit(freshLimit);
    if (error) throw error;
    freshRows = (data ?? []) as BackfillCandidate[];
  }
  // Keep the same positive gate in application code in case a mock, proxy, or
  // future query change returns more than the requested database scope.
  const candidates = [...freshRows, ...retryCandidates]
    .filter(row => row.metric_scope === 'performance') as BackfillCandidate[];
  if (candidates.length === 0) {
    return { done: 0, skipped: 0, failed: 0, refused: 0, quarantined: 0 };
  }

  const selected = selectBackfillCandidates(candidates, new Set(), limit);
  if (selected.length === 0) {
    return { done: 0, skipped: 0, failed: 0, refused: 0, quarantined: 0 };
  }

  let done = 0;
  let skipped = 0;
  let failed = 0;
  let refused = 0;
  let quarantined = 0;
  for (const t of selected) {
    try {
      const raw = await extractRawCommitments(t.raw_text, verticalName);
      const rows = buildCommitmentRows(raw, t.called_at);
      // A transcript can reach this branch with preexisting rows if a prior
      // process wrote commitments but crashed before writing the completion
      // marker. Persist remains idempotent for open rows and refuses resolved
      // rows; either outcome is then marked so it cannot starve older work.
      const result = await persistCommitments(
        supabase,
        t.id,
        t.rep_email,
        t.ghl_contact_id,
        rows,
        EXTRACT_MODEL,
      );
      if (result.ok) {
        if (result.alreadyFinalized) skipped++;
        else done++;
      } else {
        refused++;
      }
    } catch (err) {
      console.error(`Failed to extract commitments for transcript ${t.id}:`, err);
      const failureCode = isTerminalCommitmentExtractionError(err)
        ? 'deterministic_extraction_failed'
        : 'transient_dependency_failed';
      const { data: failureState, error: failureStateError } = await supabase.rpc(
        'record_commitment_extraction_failure',
        { p_transcript_id: t.id, p_failure_code: failureCode },
      );
      if (failureStateError) throw failureStateError;
      if (
        failureState !== 'retry_scheduled'
        && failureState !== 'quarantined'
        && failureState !== 'already_finalized'
        && failureState !== 'already_quarantined'
      ) {
        throw new Error(`Unexpected commitment failure-state result: ${String(failureState)}`);
      }
      if (failureState === 'already_finalized') {
        skipped++;
        continue;
      }
      if (failureState === 'quarantined' || failureState === 'already_quarantined') {
        quarantined++;
      }
      failed++;
    }
  }

  return { done, skipped, failed, refused, quarantined };
}
