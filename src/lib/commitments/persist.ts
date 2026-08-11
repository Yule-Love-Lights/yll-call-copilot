// Writes extracted commitments for one transcript. Upsert, not insert --
// same idempotency rationale as processTranscriptBatch's `learnings` write
// (src/lib/transcripts/process.ts): a retried backfill batch must not
// create duplicate rows for a transcript it already processed. The dedupe
// key is (transcript_id, kind, extraction_index) -- see
// supabase/migrations/0020_call_commitments.sql for why extraction_index,
// not detail text, is the third column. #217

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommitmentRow } from './types';

export async function persistCommitments(
  supabase: SupabaseClient,
  transcriptId: string,
  repEmail: string | null,
  ghlContactId: string | null,
  commitments: CommitmentRow[],
): Promise<void> {
  if (commitments.length === 0) return;

  // status/dismissed_reason/verified_by_event/cleared_at are deliberately
  // NOT in this payload. A later slice's verification job moves status off
  // its 'open' default -- if a re-extraction (a retried batch, or a manual
  // re-backfill) included status here, it would upsert 'open' back over a
  // row a human or the verify job had already moved to 'cleared'/'done'/
  // 'dismissed', silently reopening a settled commitment. Omitting a column
  // from the upsert payload leaves its existing value untouched on
  // conflict (Postgres ON CONFLICT DO UPDATE only SETs listed columns) and
  // only applies the table default on a genuine first insert.
  const { error } = await supabase.from('call_commitments').upsert(
    commitments.map(c => ({
      transcript_id: transcriptId,
      ghl_contact_id: ghlContactId,
      rep_email: repEmail,
      kind: c.kind,
      detail: c.detail,
      promised_at: c.promised_at,
      extraction_index: c.extraction_index,
    })),
    { onConflict: 'transcript_id,kind,extraction_index' },
  );
  if (error) throw error;
}
