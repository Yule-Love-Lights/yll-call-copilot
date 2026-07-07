-- RLS intentionally deferred to Phase 0.5 when auth lands.
-- Phase 0 schema for YLL Call Copilot: app users, a local cache of GHL
-- contacts, and a sync log. Not applied anywhere yet; kept in the repo so
-- the schema ships with the code.

create table app_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  role text not null default 'rep',
  created_at timestamptz default now()
);

create table contacts_cache (
  id uuid primary key default gen_random_uuid(),
  ghl_contact_id text unique not null,
  full_name text,
  email text,
  phone text,
  raw jsonb,
  synced_at timestamptz default now()
);

create table ghl_sync_log (
  id bigint generated always as identity primary key,
  kind text not null,
  detail jsonb,
  ok boolean not null,
  created_at timestamptz default now()
);
