// Writes extracted commitments for one transcript. Upsert, not insert --
// same idempotency rationale as processTranscriptBatch's `learnings` write
// (src/lib/transcripts/process.ts): a retried backfill batch must not
// create duplicate rows for a transcript it already processed. The dedupe
// key is (transcript_id, kind, extraction_index) -- see
// supabase/migrations/0021_call_commitments.sql for why extraction_index,
// not detail text, is the third column. #217

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommitmentRow } from './types';

export type PersistResult = { ok: true } | { ok: false; reason: 'has_resolved_commitments' };

// #217 review finding (HIGH), then a follow-up review MEDIUM on the first
// fix: the position-based dedupe key and the status-omission below are
// each individually correct, but combine badly. Scenario: a call has two
// same-kind commitments (idx0 "roofline photos", idx1 "shed photos"). The
// rep sends the roofline photos and a later slice's verify job sets
// idx0.status = 'cleared'. A forced re-extraction of the SAME transcript
// returns the two promises in the opposite order -- Claude does not
// guarantee a stable order across runs. Upserting that straight through
// would leave idx0 ('cleared') describing "shed photos" and idx1 ('open')
// describing "roofline photos": a settled commitment now mislabels what
// was actually done, against a real employee's accountability record.
//
// The first fix (chosen over a normalized-detail-hash key, for the reasons
// below) was: refuse the whole re-extraction outright once any existing
// row for this transcript has moved off 'open'. But that first version did
// the check (a SELECT) and the write (an UPSERT) as two separate
// application-level round trips with no transaction -- a TOCTOU gap. If a
// verify job sets a row's status between this function's SELECT and its
// UPSERT, the guard already passed at SELECT time and the UPSERT proceeds
// anyway, reproducing the exact mislabeling bug it was written to prevent,
// just moved into that gap instead of eliminated. Unreachable today
// (nothing mutates status concurrently in this slice), but slice 3 adds
// exactly that verify job.
//
// Fix: call_commitments_upsert_batch (supabase/migrations/
// 0022_call_commitments_upsert_fn.sql) does the check AND the write inside
// ONE plpgsql function, invoked via a single RPC round trip. It locks
// every existing row for the transcript with `for update` before deciding,
// so the whole check-then-act sequence is one statement's worth of
// atomicity at the database, not two calls from application code -- a
// concurrent verify-job UPDATE on any of those rows either blocks until
// this function's transaction commits (and then correctly proceeds against
// the now-'open'-or-not rows this function left behind) or, if it landed
// first, this function's locked SELECT waits for it and sees the real
// post-update status before deciding. Either ordering resolves correctly;
// there is no window between the check and the write for a third party to
// slip a status change into.
//
// Rejected approach (a) from the original HIGH -- a normalized-detail-hash
// key -- only shrinks the collision window (two similarly-worded promises
// of the same kind, or the same promise reworded across a re-extraction,
// still hash differently or collide) and the failure mode it leaves in
// place is silent mislabeling of a SETTLED row, not a merely wasted row --
// "usually stable" isn't an acceptable bar for that severity. Refusing
// costs a real capability (a transcript that already has a resolved
// commitment can never pick up a genuinely missed one via a forced
// re-extraction), but a bulk backfill re-run must never be able to
// silently corrupt a resolved commitment's label, and this makes that
// structurally impossible rather than merely unlikely. All rows still
// 'open' are unaffected -- reordering among open rows only swaps which
// not-yet-resolved row says what, which is harmless.
export async function persistCommitments(
  supabase: SupabaseClient,
  transcriptId: string,
  repEmail: string | null,
  ghlContactId: string | null,
  commitments: CommitmentRow[],
): Promise<PersistResult> {
  if (commitments.length === 0) return { ok: true };

  // status/dismissed_reason/verified_by_event/cleared_at are deliberately
  // NOT in this payload -- the RPC's UPSERT only SETs the columns it's
  // given (see the function body), so a row a human or the verify job
  // already moved off 'open' keeps its status untouched even in the branch
  // where the function does write (all rows still 'open').
  const { data, error } = await supabase.rpc('call_commitments_upsert_batch', {
    p_transcript_id: transcriptId,
    p_rows: commitments.map(c => ({
      ghl_contact_id: ghlContactId,
      rep_email: repEmail,
      kind: c.kind,
      detail: c.detail,
      promised_at: c.promised_at,
      extraction_index: c.extraction_index,
    })),
  });
  if (error) throw error;

  if (data === 'refused') {
    console.warn(
      `Refused re-extraction for transcript ${transcriptId}: it already has a resolved (non-'open') commitment; a reordered re-extraction could mislabel it.`,
    );
    return { ok: false, reason: 'has_resolved_commitments' };
  }
  return { ok: true };
}
