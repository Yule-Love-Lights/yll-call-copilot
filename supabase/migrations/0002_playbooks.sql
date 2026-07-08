-- RLS deferred with auth (post Phase 1).
-- Phase 1 schema for YLL Call Copilot: a vertical (a line of business) plus a
-- version history of its generated/edited call playbook. File only —
-- not applied anywhere yet, kept in the repo so the schema ships with the
-- code (same convention as 0001_init.sql).

create table verticals (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text not null default '',
  knowledge_notes text not null default '',
  active_version int not null default 0,
  season_window text,
  created_at timestamptz default now()
);

create table playbook_versions (
  id uuid primary key default gen_random_uuid(),
  vertical_id uuid not null references verticals(id) on delete cascade,
  version int not null,
  content jsonb not null,
  source text not null check (source in ('generated', 'edited')),
  created_at timestamptz default now(),
  unique(vertical_id, version)
);
