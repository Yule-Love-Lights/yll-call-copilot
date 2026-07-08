-- RLS: service-role access only, same convention as 0001/0002.
-- Phase 1.5 schema for YLL Call Copilot: per-vertical knowledge documents,
-- bulk-ingested call transcripts + their outcome label, per-call structured
-- learnings extracted by Claude, human-approvable playbook edit proposals
-- distilled from those learnings, and a lightweight job row so bulk ingest
-- can report progress across chunked requests. File only — not applied
-- anywhere yet, same convention as 0001_init.sql and 0002_playbooks.sql.

create table documents (
  id uuid primary key default gen_random_uuid(),
  vertical_id uuid references verticals(id) on delete cascade,
  title text not null,
  kind text not null check (kind in ('upload', 'note')),
  content text not null,
  created_at timestamptz default now()
);

create table transcripts (
  id uuid primary key default gen_random_uuid(),
  vertical_id uuid references verticals(id) on delete set null,
  source_file text,
  customer_name text,
  customer_phone text,
  called_at timestamptz,
  raw_text text not null,
  outcome text not null default 'unknown' check (outcome in ('booked', 'not_booked', 'unknown')),
  outcome_source text,
  ghl_contact_id text,
  created_at timestamptz default now()
);

create table learnings (
  id uuid primary key default gen_random_uuid(),
  -- unique: extraction is idempotent, keyed on this — a retried ingest
  -- batch (a timeout/crash mid-batch re-drives the same transcript through
  -- /api/ingest/continue) upserts on conflict instead of inserting a
  -- second row and silently doubling the objection/question/price-talk
  -- counts computeInsights/distillProposals read.
  transcript_id uuid references transcripts(id) on delete cascade unique,
  vertical_id uuid,
  objections jsonb,
  customer_language jsonb,
  what_worked jsonb,
  what_failed jsonb,
  price_talk jsonb,
  questions jsonb,
  summary text,
  extracted_at timestamptz default now()
);

create table playbook_proposals (
  id uuid primary key default gen_random_uuid(),
  vertical_id uuid not null references verticals(id) on delete cascade,
  section text not null,
  kind text not null check (kind in ('add', 'change', 'remove')),
  current_value jsonb,
  -- Nullable, not `not null`: every 'remove' proposal is DESIGNED to set
  -- this to null (both distillProposals' and generateBrainReview's system
  -- prompts instruct it, and apply.ts's remove path never reads it — only
  -- current_value identifies what to remove). A `not null` here made a
  -- multi-row insert containing even one remove fail its NOT NULL check
  -- and abort the whole batch. The check below keeps the constraint doing
  -- real work: only 'remove' may have a null proposed_value.
  proposed_value jsonb,
  evidence text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz default now(),
  decided_at timestamptz,
  constraint proposed_value_required_unless_remove check (proposed_value is not null or kind = 'remove')
);

create table ingest_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  total int not null default 0,
  done int not null default 0,
  failed int not null default 0,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  detail jsonb,
  created_at timestamptz default now(),
  finished_at timestamptz
);
