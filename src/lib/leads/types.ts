// Shared shapes for Phase 2+3: the scored lead queue, the calls reps log
// against a lead, the post-call follow-up drafts, and the general event
// log. Row shapes mirror supabase/migrations/0004_calls.sql — same
// convention as playbook/types.ts and transcripts/types.ts (only the
// columns the app reads/writes, not a full generated schema).

export type LeadStatus = 'queued' | 'claimed' | 'done' | 'dismissed';

// Free text in the database (no check constraint), but the app only ever
// writes these four — kept as a union here for the code that produces them.
// 'inbound' is the auto-created row for a live inbound call (webhook +
// screen-pop); 'inbound_speed' is the queue builder's speed-to-lead source.
export type LeadSource = 'inbound_speed' | 'quote_followup' | 'season_play' | 'inbound';

export type LeadRow = {
  id: string;
  ghl_contact_id: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  vertical_slug: string | null;
  reason: string;
  opener_hint: string | null;
  score: number;
  source: string;
  status: LeadStatus;
  claimed_by: string | null;
  // Contact-local IANA time zone, for the TCPA calling-hours gate
  // (src/lib/leads/callingHours.ts). Null when GHL never returned one.
  timezone: string | null;
  queued_at: string;
  done_at: string | null;
};

export type CallDirection = 'inbound' | 'outbound';
export type CallOutcome =
  | 'interested'
  | 'callback'
  | 'not_interested'
  | 'wrong_number'
  | 'voicemail'
  | 'no_answer';

export const CALL_OUTCOMES: CallOutcome[] = [
  'interested',
  'callback',
  'not_interested',
  'wrong_number',
  'voicemail',
  'no_answer',
];

// Outcomes that warrant a post-call follow-up draft (src/lib/leads/followups.ts).
export const FOLLOWUP_OUTCOMES: CallOutcome[] = ['interested', 'callback', 'voicemail'];

export type CallRow = {
  id: string;
  lead_id: string | null;
  ghl_contact_id: string | null;
  rep_email: string | null;
  direction: CallDirection;
  outcome: CallOutcome | null;
  notes: string | null;
  transcript_id: string | null;
  started_at: string;
  ended_at: string | null;
};

export type FollowupKind = 'email' | 'sms';
export type FollowupStatus = 'draft' | 'approved_sent' | 'failed';

export type FollowupRow = {
  id: string;
  call_id: string | null;
  kind: FollowupKind;
  to_address: string;
  subject: string | null;
  body: string;
  status: FollowupStatus;
  created_at: string;
  sent_at: string | null;
};

export type EventLogRow = {
  id: number;
  kind: string;
  detail: Record<string, unknown> | null;
  created_at: string;
};
