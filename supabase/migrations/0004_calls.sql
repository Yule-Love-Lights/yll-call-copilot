-- RLS: service-role only, same convention as 0001-0003.
-- Phase 2+3 schema for YLL Call Copilot: the lead queue (scored call
-- candidates pulled from GoHighLevel), the calls reps log against a lead,
-- the post-call follow-up drafts (email/SMS) a rep approves before sending,
-- and a general event log (queue builds, inbound webhook hits, sends).
-- File only — not applied anywhere yet, same convention as 0001-0003.

create table leads (
  id uuid primary key default gen_random_uuid(),
  ghl_contact_id text unique,
  full_name text,
  phone text,
  email text,
  address text,
  vertical_slug text,
  reason text not null,
  opener_hint text,
  score int not null default 0,
  source text not null,
  status text not null default 'queued' check (status in ('queued', 'claimed', 'done', 'dismissed')),
  claimed_by text,
  -- Contact-local IANA time zone (e.g. "America/Chicago"), from GHL. Nullable
  -- — not every contact has one on file. Feeds the TCPA calling-hours gate
  -- (src/lib/leads/callingHours.ts), which falls back to the company's own
  -- zone when this is null.
  timezone text,
  queued_at timestamptz default now(),
  done_at timestamptz
);

create table calls (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete set null,
  ghl_contact_id text,
  rep_email text,
  direction text not null default 'outbound' check (direction in ('inbound', 'outbound')),
  outcome text check (outcome in ('interested', 'callback', 'not_interested', 'wrong_number', 'voicemail', 'no_answer')),
  notes text,
  transcript_id uuid references transcripts(id) on delete set null,
  started_at timestamptz default now(),
  ended_at timestamptz
);

create table followups (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references calls(id) on delete cascade,
  kind text not null check (kind in ('email', 'sms')),
  to_address text not null,
  subject text,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'approved_sent', 'failed')),
  created_at timestamptz default now(),
  sent_at timestamptz
);

create table events_log (
  id bigint generated always as identity primary key,
  kind text not null,
  detail jsonb,
  created_at timestamptz default now()
);
