// Shared shapes for Phase 4: live call coaching. Row shapes mirror
// supabase/migrations/0005_live.sql -- same convention as leads/types.ts and
// transcripts/types.ts (only the columns the app reads/writes, not a full
// generated schema).

export type LiveSessionMode = 'twilio' | 'simulator';
export type LiveSessionStatus = 'starting' | 'active' | 'pending_outcome' | 'completed' | 'abandoned';

export type LiveSessionRow = {
  id: string;
  call_id: string | null;
  lead_id: string | null;
  mode: LiveSessionMode;
  status: LiveSessionStatus;
  transcript_running: string;
  dial_grant_hash: string | null;
  dial_actor_auth_user_id: string | null;
  dial_grant_expires_at: string | null;
  dial_started_at: string | null;
  media_stream_grant_hash: string | null;
  media_stream_grant_expires_at: string | null;
  media_stream_started_at: string | null;
  started_at: string;
  ended_at: string | null;
};

export type LiveSegmentRow = {
  id: string;
  session_id: string;
  ordinal: number;
  source_segment_id: string;
  speaker: 'rep' | 'customer';
  body: string;
  at_ms: number;
  silence_ms: number | null;
  created_at: string;
};

export type RepRating = 'helpful' | 'noise';

export type CoachingEventRow = {
  id: string;
  call_id: string;
  at_ms: number;
  trigger: string;
  card_text: string;
  expanded_text: string | null;
  shown: boolean;
  rep_rating: RepRating | null;
  created_at: string;
};
