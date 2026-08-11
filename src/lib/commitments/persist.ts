// Writes extracted commitments for one transcript. Upsert, not insert --
// same idempotency rationale as processTranscriptBatch's `learnings` write
// (src/lib/transcripts/process.ts): a retried backfill batch must not
// create duplicate rows for a transcript it already processed. The dedupe
// key is (transcript_id, kind, extraction_index) -- see
// supabase/migrations/0020_call_commitments.sql for why extraction_index,
// not detail text, is the third column. #217

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommitmentRow } from './types';

export type PersistResult = { ok: true } | { ok: false; reason: 'has_resolved_commitments' };

// #217 review finding (HIGH): the position-based dedupe key and the
// status-omission below are each individually correct, but combine badly.
// Scenario: a call has two same-kind commitments (idx0 "roofline photos",
// idx1 "shed photos"). The rep sends the roofline photos and a later
// slice's verify job sets idx0.status = 'cleared'. A forced re-extraction
// of the SAME transcript returns the two promises in the opposite order --
// Claude does not guarantee a stable order across runs. Upserting that
// straight through would leave idx0 ('cleared') describing "shed photos"
// and idx1 ('open') describing "roofline photos": a settled commitment now
// mislabels what was actually done, against a real employee's
// accountability record. That is worse than the reopen bug status-omission
// prevents.
//
// Fix (approach b, chosen over a normalized-detail-hash key): refuse the
// WHOLE re-extraction outright once any existing row for this transcript
// has moved off 'open'. Rejected approach (a) -- a normalized-detail hash
// as the third key column -- only shrinks the collision window (two
// similarly-worded promises of the same kind, or the same promise
// reworded across a re-extraction, still hash differently or collide) and
// the failure mode it leaves in place is silent mislabeling of a SETTLED
// row, not a merely wasted row -- "usually stable" isn't an acceptable bar
// for that severity. Refusing costs a real capability (a transcript that
// already has a resolved commitment can never pick up a genuinely missed
// one via a forced re-extraction), but a bulk backfill re-run must never
// be able to silently corrupt a resolved commitment's label, and this
// makes that structurally impossible rather than merely unlikely. All rows
// still 'open' are unaffected -- reordering among open rows only swaps
// which not-yet-resolved row says what, which is harmless.
export async function persistCommitments(
  supabase: SupabaseClient,
  transcriptId: string,
  repEmail: string | null,
  ghlContactId: string | null,
  commitments: CommitmentRow[],
): Promise<PersistResult> {
  if (commitments.length === 0) return { ok: true };

  const { data: existingRows, error: existingError } = await supabase
    .from('call_commitments')
    .select('status')
    .eq('transcript_id', transcriptId);
  if (existingError) throw existingError;
  const hasResolvedRow = ((existingRows ?? []) as { status: string }[]).some(r => r.status !== 'open');
  if (hasResolvedRow) {
    console.warn(
      `Refused re-extraction for transcript ${transcriptId}: it already has a resolved (non-'open') commitment; a reordered re-extraction could mislabel it.`,
    );
    return { ok: false, reason: 'has_resolved_commitments' };
  }

  // status/dismissed_reason/verified_by_event/cleared_at are deliberately
  // NOT in this payload. A later slice's verification job moves status off
  // its 'open' default -- if a re-extraction (a retried batch, or a manual
  // re-backfill) included status here, it would upsert 'open' back over a
  // row a human or the verify job had already moved to 'cleared'/'done'/
  // 'dismissed', silently reopening a settled commitment. Omitting a column
  // from the upsert payload leaves its existing value untouched on
  // conflict (Postgres ON CONFLICT DO UPDATE only SETs listed columns) and
  // only applies the table default on a genuine first insert. (Reaching
  // this upsert at all means every existing row, if any, is still 'open' --
  // the guard above already refused otherwise.)
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
  return { ok: true };
}
