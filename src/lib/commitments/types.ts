// Shared shapes for #217 slice 1: the commitment extractor and its
// call_commitments table (supabase/migrations/0021_call_commitments.sql).

export type CommitmentKind = 'send_quote' | 'send_photos' | 'callback' | 'schedule_estimate' | 'send_info' | 'other';

export const COMMITMENT_KINDS: CommitmentKind[] = [
  'send_quote',
  'send_photos',
  'callback',
  'schedule_estimate',
  'send_info',
  'other',
];

// Commitments are short-term post-call promises. A model-generated date more
// than 30 days from the call is almost certainly a parsing error, and negative
// offsets would place an open promise before it was made.
export const MAX_PROMISED_DAY_OFFSET = 30;

// What extractRawCommitments (extract.ts) returns per commitment, straight
// off the model's tool call -- promised_time_local/promised_day_offset are
// resolved into an absolute promised_at instant separately (time.ts), kept
// apart from the LLM call so that resolution logic is testable without
// mocking Claude.
export type RawCommitment = {
  kind: CommitmentKind;
  detail: string;
  promised_time_local: string | null;
  promised_day_offset: number | null;
};

// What buildCommitmentRows (build.ts) produces per commitment, ready for
// persistCommitments to write (plus the transcript-level fields it adds:
// transcript_id, rep_email, ghl_contact_id).
export type CommitmentRow = {
  kind: CommitmentKind;
  detail: string;
  promised_at: string | null;
  extraction_index: number;
};
