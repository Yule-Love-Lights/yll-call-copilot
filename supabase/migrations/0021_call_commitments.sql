-- Ledger #217 slice 1: rep commitments extracted from a call transcript
-- ("I'll send your quote today", "I'll call you back at 3"). Today the LLM
-- pass (src/lib/transcripts/extract.ts) reads these promises and they die in
-- `learnings.summary` free text; this table stores them as typed rows so
-- later slices can surface them and auto-verify against real events.
--
-- DEDUPE KEY -- (transcript_id, kind, extraction_index):
--
-- A naive key of (transcript_id, kind) would silently collapse two distinct
-- promises of the same kind on one call (e.g. "I'll send you the roofline
-- quote today" AND, later in the same call, "I'll also send a quote for the
-- shed" -- both send_quote). A key on (transcript_id, kind, detail) avoids
-- that collapse but breaks idempotency the other way: Claude is not
-- byte-deterministic, so re-extracting the SAME transcript can phrase
-- `detail` slightly differently on the second run and insert a duplicate
-- row instead of updating the first.
--
-- extraction_index is the position of a commitment within its own kind
-- group, in the order the extractor returned them (src/lib/commitments/
-- build.ts assigns it) -- stable across re-extractions of the same
-- transcript even though the wording of `detail` is not. Re-extracting
-- upserts on (transcript_id, kind, extraction_index): the row count for a
-- transcript never grows past what one extraction pass produced, and two
-- same-kind promises always land on two separate rows (index 0 and 1).
--
-- RLS: service-role only, same default-deny convention as
-- 0019_existing_tables_default_deny.sql -- that migration revoked default
-- table/schema privileges for every FUTURE table too, so this table must
-- explicitly enable RLS and grant itself the minimal service-role access it
-- needs; nothing here is reachable through the anon/authenticated Data API.
-- This table holds customer PII (a promise tied to a phone/contact), so RLS
-- is mandatory, not optional.

create table call_commitments (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references transcripts(id) on delete cascade,
  ghl_contact_id text,
  -- Same identity column and convention as transcripts.rep_email
  -- (0007_recordings.sql) -- the recordings pipeline writes rep identity
  -- there directly, so this mirrors it rather than inventing a new rep
  -- identifier.
  rep_email text,
  kind text not null check (kind in ('send_quote', 'send_photos', 'callback', 'schedule_estimate', 'send_info', 'other')),
  detail text not null,
  -- Anchored to the CALL's wall-clock time (America/New_York), not
  -- extraction time -- see src/lib/commitments/time.ts. Nullable: not every
  -- commitment carries a specific time ("I'll follow up soon").
  promised_at timestamptz,
  status text not null default 'open' check (status in ('open', 'cleared', 'done', 'dismissed', 'expired')),
  dismissed_reason text,
  -- Free text naming the event that verified/cleared this commitment (e.g.
  -- "quote sent 2026-08-12", a GHL event id). Populated by a later slice's
  -- verification job -- nullable and unused by this slice's extractor.
  verified_by_event text,
  -- See DEDUPE KEY note above. Zero-based, per (transcript_id, kind).
  extraction_index int not null default 0,
  created_at timestamptz not null default now(),
  cleared_at timestamptz
);

create unique index call_commitments_dedupe_key
  on call_commitments (transcript_id, kind, extraction_index);

alter table public.call_commitments enable row level security;
alter table public.call_commitments force row level security;

revoke all privileges on table public.call_commitments
  from public, anon, authenticated, service_role;

-- The current application performs these operations only after its
-- server-side capability and resource checks, same grant shape as every
-- other table in 0019_existing_tables_default_deny.sql's loop.
grant select, insert, update, delete on table public.call_commitments
  to service_role;
