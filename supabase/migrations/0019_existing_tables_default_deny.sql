-- Phase 0 database boundary for the legacy Office application.
--
-- Browser sessions use Supabase only for Auth. Application data is accessed
-- through capability-checked server handlers using the service-role client.
-- Keep that boundary explicit: every current application table has RLS with
-- zero client policies, and every future public object starts without API-role
-- privileges until a later migration reviews it.

set lock_timeout = '5s';
set statement_timeout = '60s';

do $phase0$
declare
  expected_tables constant text[] := array[
    'app_users',
    'brain_insights',
    'brain_reviews',
    'call_recordings',
    'call_scores',
    'calls',
    'coach_settings',
    'coaching_events',
    'contacts_cache',
    'documents',
    'email_reply_drafts',
    'events_log',
    'feedback_cards',
    'followups',
    'ghl_sync_log',
    'inbound_emails',
    'ingest_jobs',
    'leads',
    'learnings',
    'live_sessions',
    'offer_versions',
    'playbook_proposals',
    'playbook_versions',
    'practice_sessions',
    'recording_sync_state',
    'rubric_versions',
    'second_mile_scans',
    'second_mile_touches',
    'transcripts',
    'verticals',
    'weekly_digests'
  ];
  table_name text;
  missing_tables text[];
  unexpected_tables text[];
begin
  if not exists (
    select 1
    from pg_roles
    where rolname = 'service_role'
      and rolbypassrls
  ) then
    raise exception
      'service_role is absent or lacks BYPASSRLS; refusing default-deny migration';
  end if;

  if to_regrole('anon') is null or to_regrole('authenticated') is null then
    raise exception 'Required Supabase API roles are absent';
  end if;

  select array_agg(name order by name)
  into missing_tables
  from unnest(expected_tables) as expected(name)
  where not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = expected.name
      and c.relkind in ('r', 'p')
  );

  if coalesce(cardinality(missing_tables), 0) > 0 then
    raise exception 'Missing expected Hub tables: %', missing_tables;
  end if;

  select array_agg(c.relname::text order by c.relname)
  into unexpected_tables
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and not (c.relname = any(expected_tables))
    and not exists (
      select 1
      from pg_depend d
      where d.classid = 'pg_class'::regclass
        and d.objid = c.oid
        and d.deptype = 'e'
    );

  if coalesce(cardinality(unexpected_tables), 0) > 0 then
    raise exception
      'Unreviewed non-extension public tables: %',
      unexpected_tables;
  end if;

  if exists (
    select 1
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(expected_tables)
  ) then
    raise exception
      'Unreviewed live RLS policies exist; inspect them before continuing';
  end if;

  foreach table_name in array expected_tables loop
    execute format(
      'alter table public.%I enable row level security',
      table_name
    );
    execute format(
      'alter table public.%I force row level security',
      table_name
    );

    execute format(
      'revoke all privileges on table public.%I
         from public, anon, authenticated, service_role',
      table_name
    );

    -- The current application performs these operations only after its
    -- server-side capability and resource checks.
    execute format(
      'grant select, insert, update, delete on table public.%I
         to service_role',
      table_name
    );
  end loop;
end
$phase0$;

revoke all privileges
  on sequence public.ghl_sync_log_id_seq,
              public.events_log_id_seq
  from public, anon, authenticated, service_role;

grant usage, select
  on sequence public.ghl_sync_log_id_seq,
              public.events_log_id_seq
  to service_role;

-- API roles need schema visibility for normal PostgREST error handling, but no
-- application role needs to create database objects at runtime.
revoke create on schema public
  from public, anon, authenticated, service_role;
grant usage on schema public
  to anon, authenticated, service_role;

-- PostgreSQL grants PUBLIC function execution by default. The repository has
-- no application RPC functions today; future functions must opt in explicitly.
alter default privileges for role postgres in schema public
  revoke all privileges on functions
  from public, anon, authenticated, service_role;

-- Fail closed for future tables and sequences too. A feature migration must
-- explicitly enable RLS and grant the minimal server access it needs.
alter default privileges for role postgres in schema public
  revoke all privileges on tables
  from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all privileges on sequences
  from public, anon, authenticated, service_role;
