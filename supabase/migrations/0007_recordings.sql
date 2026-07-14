-- RLS: service-role only, same convention as 0001-0006.
-- Workstream 1 schema for the YLL Sales Excellence system (see
-- docs/SALES-EXCELLENCE-PLAN.md, section 4): completed-call recordings flow
-- from GoHighLevel into this app automatically every night. `call_recordings`
-- is the idempotency ledger -- one row per GHL call message, keyed on
-- ghl_message_id so a re-run of the nightly sync never double-inserts the
-- same call. `recording_sync_state` is a single-row table (id always 1)
-- tracking the last successful sync time, so each nightly run only asks GHL
-- for calls since the previous run instead of re-scanning everything.
--
-- The `transcripts` table (0003_knowledge.sql) already holds every
-- uploaded/ingested call; this migration adds the columns a call-recording
-- row needs once it's transcribed, so the SAME extraction pipeline
-- (src/lib/transcripts/process.ts, extract.ts) processes a GHL recording
-- exactly like an uploaded transcript. File only -- not applied anywhere
-- yet, same convention as 0001-0006.

create table call_recordings (
  id uuid primary key default gen_random_uuid(),
  ghl_message_id text unique,
  ghl_contact_id text,
  ghl_conversation_id text,
  ghl_user_id text,
  direction text,
  called_at timestamptz,
  duration_seconds int,
  status text not null default 'pending' check (status in ('pending', 'transcribed', 'skipped', 'failed')),
  skip_reason text,
  transcript_id uuid references transcripts(id) on delete set null,
  detail jsonb,
  created_at timestamptz default now()
);

create table recording_sync_state (
  id int primary key default 1 check (id = 1),
  last_synced_at timestamptz,
  detail jsonb
);

-- Columns the recordings pipeline needs on an existing transcripts row: the
-- rep who took the call, the call's direction and length, and the diarized
-- Deepgram utterance array ({speaker, start, end, text} per turn) the
-- scoring engine (a later workstream) reads for talk-ratio and dead-air
-- math. Nullable -- every uploaded/ingested transcript that predates this
-- migration has none of these, and the existing extraction pipeline never
-- reads them.
alter table transcripts add column rep_email text;
alter table transcripts add column direction text;
alter table transcripts add column duration_seconds int;
alter table transcripts add column utterances jsonb;
