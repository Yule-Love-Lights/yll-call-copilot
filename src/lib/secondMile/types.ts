// Shared shapes for Workstream 7 (the second-mile task queue). Row shape
// mirrors supabase/migrations/0013_second_mile.sql -- same convention as
// src/lib/leads/types.ts (only the columns the app reads/writes).

export type SecondMileTouchKind = 'reveal_photo' | 'personal_touch' | 'cookies_ornament' | 'cold_snap_checkin';
export type SecondMileTouchStatus = 'pending' | 'done' | 'skipped';

export const SECOND_MILE_TOUCH_KINDS: SecondMileTouchKind[] = [
  'reveal_photo',
  'personal_touch',
  'cookies_ornament',
  'cold_snap_checkin',
];

// The only kinds a rep can Draft + Send a message for -- cookies_ornament
// and personal_touch are checklist items only (see AGENTS spec point 5).
export const SENDABLE_TOUCH_KINDS: SecondMileTouchKind[] = ['reveal_photo', 'cold_snap_checkin'];

export type SecondMileTouchRow = {
  id: string;
  ghl_contact_id: string | null;
  customer_name: string | null;
  kind: SecondMileTouchKind;
  status: SecondMileTouchStatus;
  due_at: string | null;
  payload: Record<string, unknown> | null;
  dedupe_key: string;
  created_at: string;
  done_at: string | null;
  done_by: string | null;
};

export type SecondMileScanRow = {
  transcript_id: string;
  scanned_at: string;
  touches_found: number;
};

// A row shaped for insertion via supabase upsert(..., {onConflict: 'dedupe_key', ignoreDuplicates: true}).
export type SecondMileInsertCandidate = {
  ghl_contact_id: string | null;
  customer_name: string | null;
  kind: SecondMileTouchKind;
  status: 'pending';
  due_at: string | null;
  payload: Record<string, unknown> | null;
  dedupe_key: string;
};

// A won/installed job's contact, the shared source for the cookies+ornament
// run, the reveal-photo prompt, and the cold-snap check-in (see
// src/lib/ghl/secondMile.ts for how this gets built from GHL, and
// docs/... deviation notes in the PR for the transcript fallback).
export type WonJobContact = {
  ghlContactId: string;
  customerName: string | null;
  address: string | null;
};

export type PersonalTouchDetail = {
  detail: string;
  category: string;
  quote: string;
};
