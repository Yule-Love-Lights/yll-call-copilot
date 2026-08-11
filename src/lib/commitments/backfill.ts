// Backfill-capable entry point so existing transcripts can be processed
// through the commitment extractor -- same shared-batch-processor shape as
// src/lib/scoring/batch.ts's scoreNextBatch and src/lib/transcripts/
// process.ts's processTranscriptBatch. #217
//
// Candidate selection is a best-effort cost optimization, not a
// correctness guarantee: a transcript that legitimately has zero rep
// commitments never gets a call_commitments row, so it can never be marked
// "already extracted" by presence alone and will be re-scanned (and
// re-billed to Claude) on every backfill run. That's wasted cost, not a
// bug -- persistCommitments is idempotent regardless, and this is a
// manually-triggered backfill, not an autonomous cron. A later slice can
// add real processed-tracking if that cost becomes worth solving.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '../supabase';
import { extractRawCommitments } from './extract';
import { buildCommitmentRows } from './build';
import { persistCommitments } from './persist';

// Bounded read window, same rationale as scoring/batch.ts's
// CANDIDATE_WINDOW: several consecutive runs clear a same-day backlog
// without an unbounded scan of the whole transcripts table.
const CANDIDATE_WINDOW = 200;

export type BackfillCandidate = {
  id: string;
  raw_text: string;
  called_at: string | null;
  rep_email: string | null;
  ghl_contact_id: string | null;
};

export type BackfillResult = { done: number; skipped: number; failed: number };

// Pure selection, mirroring selectScoreCandidates: drop transcripts that
// already have at least one commitment row, then cap at `limit`.
export function selectBackfillCandidates(
  candidates: BackfillCandidate[],
  alreadyExtractedIds: ReadonlySet<string>,
  limit: number,
): BackfillCandidate[] {
  return candidates.filter(c => !alreadyExtractedIds.has(c.id)).slice(0, limit);
}

export async function backfillCommitments(
  supabase: SupabaseClient,
  verticalName: string,
  limit: number,
): Promise<BackfillResult> {
  const { data: transcriptRows, error: transcriptsError } = await supabase
    .from('transcripts')
    .select('id, raw_text, called_at, rep_email, ghl_contact_id')
    .order('called_at', { ascending: false, nullsFirst: false })
    .limit(CANDIDATE_WINDOW);
  if (transcriptsError) {
    if (isMissingTableError(transcriptsError)) return { done: 0, skipped: 0, failed: 0 };
    console.error('Load candidate transcripts for commitment backfill failed:', transcriptsError);
    return { done: 0, skipped: 0, failed: 0 };
  }
  const candidates = (transcriptRows ?? []) as BackfillCandidate[];
  if (candidates.length === 0) return { done: 0, skipped: 0, failed: 0 };

  const candidateIds = candidates.map(c => c.id);
  const { data: existingRows, error: existingError } = await supabase
    .from('call_commitments')
    .select('transcript_id')
    .in('transcript_id', candidateIds);
  if (existingError && !isMissingTableError(existingError)) {
    console.error('Load already-extracted transcript ids for commitment backfill failed:', existingError);
    return { done: 0, skipped: 0, failed: 0 };
  }
  const alreadyExtracted = new Set((existingRows ?? []).map(r => (r as { transcript_id: string }).transcript_id));

  const selected = selectBackfillCandidates(candidates, alreadyExtracted, limit);
  const skipped = candidates.length - alreadyExtracted.size - selected.length;
  if (selected.length === 0) return { done: 0, skipped: Math.max(0, skipped), failed: 0 };

  let done = 0;
  let failed = 0;
  for (const t of selected) {
    try {
      const raw = await extractRawCommitments(t.raw_text, verticalName);
      const rows = buildCommitmentRows(raw, t.called_at);
      await persistCommitments(supabase, t.id, t.rep_email, t.ghl_contact_id, rows);
      done++;
    } catch (err) {
      console.error(`Failed to extract commitments for transcript ${t.id}:`, err);
      failed++;
    }
  }

  return { done, skipped: Math.max(0, skipped), failed };
}
