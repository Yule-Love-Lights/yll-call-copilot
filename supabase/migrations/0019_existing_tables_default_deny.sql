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
  expected_sequences constant text[] := array[
    'events_log_id_seq',
    'ghl_sync_log_id_seq'
  ];
  table_name text;
  column_list text;
  missing_tables text[];
  missing_sequences text[];
  unexpected_relations text[];
  unexpected_sequences text[];
  unexpected_routines text[];
  unexpected_triggers text[];
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

  select array_agg(name order by name)
  into missing_sequences
  from unnest(expected_sequences) as expected(name)
  where not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = expected.name
      and c.relkind = 'S'
  );

  if coalesce(cardinality(missing_sequences), 0) > 0 then
    raise exception 'Missing expected Hub sequences: %', missing_sequences;
  end if;

  select array_agg(c.relname::text order by c.relname)
  into unexpected_relations
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and not (
      c.relkind in ('r', 'p')
      and c.relname = any(expected_tables)
    )
    and not exists (
      select 1
      from pg_depend d
      where d.classid = 'pg_class'::regclass
        and d.objid = c.oid
        and d.deptype = 'e'
    );

  if coalesce(cardinality(unexpected_relations), 0) > 0 then
    raise exception
      'Unreviewed non-extension public relations: %',
      unexpected_relations;
  end if;

  select array_agg(c.relname::text order by c.relname)
  into unexpected_sequences
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'S'
    and not (c.relname = any(expected_sequences))
    and not exists (
      select 1
      from pg_depend d
      where d.classid = 'pg_class'::regclass
        and d.objid = c.oid
        and d.deptype = 'e'
    );

  if coalesce(cardinality(unexpected_sequences), 0) > 0 then
    raise exception
      'Unreviewed non-extension public sequences: %',
      unexpected_sequences;
  end if;

  select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
  into unexpected_routines
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (
      select 1
      from pg_depend d
      where d.classid = 'pg_proc'::regclass
        and d.objid = p.oid
        and d.deptype = 'e'
    );

  if coalesce(cardinality(unexpected_routines), 0) > 0 then
    raise exception
      'Unreviewed non-extension public routines: %',
      unexpected_routines;
  end if;

  select array_agg(
    format('%I.%I', c.relname, t.tgname)
    order by c.relname, t.tgname
  )
  into unexpected_triggers
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and not t.tgisinternal;

  if coalesce(cardinality(unexpected_triggers), 0) > 0 then
    raise exception
      'Unreviewed non-internal public triggers: %',
      unexpected_triggers;
  end if;

  if exists (
    select 1
    from pg_publication_tables publication
    where publication.schemaname = 'public'
      and publication.tablename = any(expected_tables)
  ) then
    raise exception
      'Hub tables are unexpectedly exposed through a publication';
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

    -- Table-level revokes do not erase historical per-column grants.
    select string_agg(format('%I', attribute.attname), ', ' order by attribute.attnum)
    into column_list
    from pg_attribute attribute
    where attribute.attrelid = format('public.%I', table_name)::regclass
      and attribute.attnum > 0
      and not attribute.attisdropped;

    execute format(
      'revoke select (%1$s), insert (%1$s), update (%1$s), references (%1$s)
         on table public.%2$I
         from public, anon, authenticated, service_role',
      column_list,
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

-- Browser sessions use the Auth service, not the public Data API. Denying
-- schema usage also closes any extension-owned view or routine that happens to
-- live in public; the server role alone can resolve application objects.
revoke all privileges on schema public
  from public, anon, authenticated, service_role;
grant usage on schema public
  to service_role;

-- PostgreSQL grants PUBLIC function execution by default. The repository has
-- no application RPC functions today; future functions must opt in explicitly.
-- The global revoke is required because per-schema defaults are additive and
-- cannot cancel PostgreSQL's built-in PUBLIC EXECUTE default by themselves.
alter default privileges for role postgres
  revoke execute on functions
  from public;

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
