-- RLS: service-role only, same convention as 0001-0004.
-- Phase 4 schema for YLL Call Copilot: live coaching. A live_sessions row is
-- the "there is (or was) a live-coached call happening against this calls
-- row" anchor -- created the moment a rep clicks "Start coached call", before
-- any outcome is known. coaching_events are the individual cards the coach
-- surfaced during that session, one per fired trigger, with the rep's
-- optional helpful/noise feedback. File only -- not applied anywhere yet,
-- same convention as 0001-0004.

create table live_sessions (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references calls(id) on delete cascade,
  mode text not null check (mode in ('twilio', 'simulator')),
  status text not null default 'active' check (status in ('active', 'ended')),
  transcript_running text not null default '',
  started_at timestamptz default now(),
  ended_at timestamptz
);

create table coaching_events (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references calls(id) on delete cascade,
  at_ms int not null,
  trigger text not null,
  card_text text not null,
  expanded_text text,
  shown boolean not null default true,
  rep_rating text check (rep_rating in ('helpful', 'noise')),
  created_at timestamptz default now()
);
