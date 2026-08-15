begin;

create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;

select no_plan();

create temporary table expected_hub_tables (
  table_name text primary key
) on commit drop;

insert into expected_hub_tables (table_name) values
  ('app_users'),
  ('brain_insights'),
  ('brain_reviews'),
  ('call_commitments'),
  ('call_recordings'),
  ('call_scores'),
  ('calls'),
  ('coach_settings'),
  ('coaching_events'),
  ('contacts_cache'),
  ('documents'),
  ('email_reply_drafts'),
  ('events_log'),
  ('feedback_cards'),
  ('followups'),
  ('ghl_sync_log'),
  ('inbound_emails'),
  ('ingest_jobs'),
  ('leads'),
  ('learnings'),
  ('live_sessions'),
  ('offer_versions'),
  ('playbook_proposals'),
  ('playbook_versions'),
  ('practice_sessions'),
  ('recording_sync_state'),
  ('rubric_versions'),
  ('second_mile_scans'),
  ('second_mile_touches'),
  ('transcripts'),
  ('verticals'),
  ('weekly_digests');

select set_eq(
  $sql$
    select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and not exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_class'::regclass
          and d.objid = c.oid
          and d.deptype = 'e'
      )
  $sql$,
  $sql$ select table_name from expected_hub_tables $sql$,
  'the reviewed public-table manifest is exact'
);

select set_eq(
  $sql$
    select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'S'
      and not exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_class'::regclass
          and d.objid = c.oid
          and d.deptype = 'e'
      )
  $sql$,
  $sql$ values ('events_log_id_seq'::text), ('ghl_sync_log_id_seq'::text) $sql$,
  'the reviewed public-sequence manifest is exact'
);

-- Application routines in `public` are RLS-bypass surface: a security definer
-- function runs with its owner's rights, so it can read and write tables that
-- deny the caller. This assertion used to be "there are none" (count = 0).
-- #217 adds the first one, so it is now an explicit ALLOWLIST -- deliberately
-- NOT a count, because `count = 1` would let ANY future unreviewed routine
-- through and this test exists precisely to stop that. A new routine fails
-- here until someone names it and justifies it.
--
-- call_commitments_upsert_batch: security definer on purpose. It locks the
-- transcript's existing rows with `select ... for update`, decides whether a
-- re-extraction is safe, and upserts -- all in ONE transaction. Splitting the
-- check from the write reopens a TOCTOU race that lets a reordered
-- re-extraction rewrite a RESOLVED commitment's text while its settled status
-- stays put, i.e. an employee's record showing a promise kept that never was.
-- PostgREST cannot express a conditional upsert, so the guard has to live in
-- the database. It writes only call_commitments and pins its search_path.
select set_eq(
  $sql$
    select routine.proname::text
    from pg_proc routine
    join pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and not exists (
        select 1
        from pg_depend dependency
        where dependency.classid = 'pg_proc'::regclass
          and dependency.objid = routine.oid
          and dependency.deptype = 'e'
      )
  $sql$,
  $sql$ values ('call_commitments_upsert_batch'::text) $sql$,
  'every application routine that can bypass table RLS is on the reviewed list'
);

select is(
  (
    select count(*)::bigint
    from pg_trigger trigger_record
    join pg_class relation on relation.oid = trigger_record.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and not trigger_record.tgisinternal
  ),
  0::bigint,
  'no unreviewed application trigger can run with server writes'
);

select is(
  (
    select count(*)::bigint
    from pg_publication_tables publication
    join expected_hub_tables expected on expected.table_name = publication.tablename
    where publication.schemaname = 'public'
  ),
  0::bigint,
  'Hub application tables are absent from database publications'
);

select is(
  (select count(*)::bigint from pg_publication where puballtables),
  0::bigint,
  'no all-tables publication can capture future Hub tables'
);

select is(
  (
    select count(*)::bigint
    from pg_publication_namespace publication_namespace
    join pg_namespace namespace
      on namespace.oid = publication_namespace.pnnspid
    where namespace.nspname = 'public'
  ),
  0::bigint,
  'no public-schema publication can capture future Hub tables'
);

select ok(
  c.relrowsecurity,
  format('%I has row-level security enabled', expected.table_name)
)
from expected_hub_tables expected
join pg_class c on c.oid = format('public.%I', expected.table_name)::regclass
order by expected.table_name;

select ok(
  c.relforcerowsecurity,
  format('%I forces row-level security for non-bypass owners', expected.table_name)
)
from expected_hub_tables expected
join pg_class c on c.oid = format('public.%I', expected.table_name)::regclass
order by expected.table_name;

select is(
  (
    select count(*)::bigint
    from pg_policies policies
    join expected_hub_tables expected on expected.table_name = policies.tablename
    where policies.schemaname = 'public'
  ),
  0::bigint,
  'legacy application tables have zero client allow policies'
);

select ok(
  not has_table_privilege('anon', format('public.%I', table_name), 'SELECT')
    and not has_table_privilege('anon', format('public.%I', table_name), 'INSERT')
    and not has_table_privilege('anon', format('public.%I', table_name), 'UPDATE')
    and not has_table_privilege('anon', format('public.%I', table_name), 'DELETE')
    and not has_table_privilege('anon', format('public.%I', table_name), 'TRUNCATE')
    and not has_table_privilege('anon', format('public.%I', table_name), 'REFERENCES')
    and not has_table_privilege('anon', format('public.%I', table_name), 'TRIGGER')
    and not has_table_privilege('anon', format('public.%I', table_name), 'MAINTAIN'),
  format('anon has no table privileges on %I', table_name)
)
from expected_hub_tables
order by table_name;

select ok(
  not has_any_column_privilege('anon', format('public.%I', table_name), 'SELECT')
    and not has_any_column_privilege('anon', format('public.%I', table_name), 'INSERT')
    and not has_any_column_privilege('anon', format('public.%I', table_name), 'UPDATE')
    and not has_any_column_privilege('anon', format('public.%I', table_name), 'REFERENCES'),
  format('anon has no historical column-level privileges on %I', table_name)
)
from expected_hub_tables
order by table_name;

select ok(
  not has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT')
    and not has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT')
    and not has_table_privilege('authenticated', format('public.%I', table_name), 'UPDATE')
    and not has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE')
    and not has_table_privilege('authenticated', format('public.%I', table_name), 'TRUNCATE')
    and not has_table_privilege('authenticated', format('public.%I', table_name), 'REFERENCES')
    and not has_table_privilege('authenticated', format('public.%I', table_name), 'TRIGGER')
    and not has_table_privilege('authenticated', format('public.%I', table_name), 'MAINTAIN'),
  format('authenticated has no table privileges on %I', table_name)
)
from expected_hub_tables
order by table_name;

select ok(
  not has_any_column_privilege('authenticated', format('public.%I', table_name), 'SELECT')
    and not has_any_column_privilege('authenticated', format('public.%I', table_name), 'INSERT')
    and not has_any_column_privilege('authenticated', format('public.%I', table_name), 'UPDATE')
    and not has_any_column_privilege('authenticated', format('public.%I', table_name), 'REFERENCES'),
  format('authenticated has no historical column-level privileges on %I', table_name)
)
from expected_hub_tables
order by table_name;

select ok(
  has_table_privilege('service_role', format('public.%I', table_name), 'SELECT')
    and has_table_privilege('service_role', format('public.%I', table_name), 'INSERT')
    and has_table_privilege('service_role', format('public.%I', table_name), 'UPDATE')
    and has_table_privilege('service_role', format('public.%I', table_name), 'DELETE')
    and not has_table_privilege('service_role', format('public.%I', table_name), 'TRUNCATE')
    and not has_table_privilege('service_role', format('public.%I', table_name), 'REFERENCES')
    and not has_table_privilege('service_role', format('public.%I', table_name), 'TRIGGER')
    and not has_table_privilege('service_role', format('public.%I', table_name), 'MAINTAIN'),
  format('service_role has only compatibility DML on %I', table_name)
)
from expected_hub_tables
order by table_name;

select ok(
  (select rolbypassrls from pg_roles where rolname = 'service_role'),
  'service_role is the explicit RLS-bypass server role'
);

select ok(
  not (select rolsuper or rolbypassrls from pg_roles where rolname = 'anon')
    and not (
      select rolsuper or rolbypassrls
      from pg_roles
      where rolname = 'authenticated'
    ),
  'user-facing database roles cannot bypass RLS'
);

select ok(
  not has_sequence_privilege('anon', 'public.ghl_sync_log_id_seq', 'USAGE')
    and not has_sequence_privilege('anon', 'public.events_log_id_seq', 'USAGE'),
  'anon cannot consume Hub identity sequences'
);

select ok(
  not has_sequence_privilege('authenticated', 'public.ghl_sync_log_id_seq', 'USAGE')
    and not has_sequence_privilege('authenticated', 'public.events_log_id_seq', 'USAGE'),
  'authenticated cannot consume Hub identity sequences'
);

select ok(
  has_sequence_privilege('service_role', 'public.ghl_sync_log_id_seq', 'USAGE')
    and has_sequence_privilege('service_role', 'public.events_log_id_seq', 'USAGE')
    and not has_sequence_privilege('service_role', 'public.ghl_sync_log_id_seq', 'UPDATE')
    and not has_sequence_privilege('service_role', 'public.events_log_id_seq', 'UPDATE'),
  'service_role can consume but cannot reset Hub identity sequences'
);

select ok(
  not has_schema_privilege('anon', 'public', 'USAGE')
    and not has_schema_privilege('anon', 'public', 'CREATE')
    and not has_schema_privilege('authenticated', 'public', 'USAGE')
    and not has_schema_privilege('authenticated', 'public', 'CREATE')
    and has_schema_privilege('service_role', 'public', 'USAGE')
    and not has_schema_privilege('service_role', 'public', 'CREATE'),
  'only service_role can resolve public-schema application objects'
);

insert into public.app_users (email, role)
values ('rls-probe@example.invalid', 'rep');

-- These transaction-local grants prove the RLS layer independently of the
-- ACL layer. They disappear on rollback.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.app_users
  to anon, authenticated;

set local role anon;
select is(
  (select count(*) from public.app_users where email = 'rls-probe@example.invalid'),
  0::bigint,
  'logged-out role cannot read a row even with a temporary table grant'
);
select throws_ok(
  $sql$
    insert into public.app_users (email, role)
    values ('anon-bypass@example.invalid', 'rep')
  $sql$,
  '42501',
  null,
  'logged-out role cannot insert a row even with a temporary table grant'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(
  (select count(*) from public.app_users where email = 'rls-probe@example.invalid'),
  0::bigint,
  'authenticated JWT cannot read a row even with a temporary table grant'
);
select throws_ok(
  $sql$
    insert into public.app_users (email, role)
    values ('authenticated-bypass@example.invalid', 'rep')
  $sql$,
  '42501',
  null,
  'authenticated JWT cannot insert a row even with a temporary table grant'
);

-- These labels are deliberately claims-shaped only: immutable employee and
-- membership rows land in the next slice. The assertions prove that no
-- caller-supplied persona claim can bypass today's API-only boundary.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","employee_status":"inactive"}';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select is((select count(*) from public.app_users), 0::bigint,
  'an inactive-shaped JWT claim remains default-denied');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","employee_id":"self","department":"office"}';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select is((select count(*) from public.app_users), 0::bigint,
  'a self-shaped JWT claim remains default-denied');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated","department":"wrong"}';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
select is((select count(*) from public.app_users), 0::bigint,
  'a wrong-department-shaped JWT claim remains default-denied');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated","membership_version":"stale"}';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select is((select count(*) from public.app_users), 0::bigint,
  'a stale-membership-shaped JWT claim remains default-denied');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated","employee_id":null}';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select is((select count(*) from public.app_users), 0::bigint,
  'an unlinked-identity-shaped JWT claim remains default-denied');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated","department":"office"}';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000007';
select is((select count(*) from public.app_users), 0::bigint,
  'an Office-shaped JWT claim remains default-denied');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000008","role":"authenticated","department":"advertising"}';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000008';
select is((select count(*) from public.app_users), 0::bigint,
  'an Advertising-shaped JWT claim remains default-denied');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated","department":"installer"}';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000009';
select is((select count(*) from public.app_users), 0::bigint,
  'an Installer-shaped JWT claim remains default-denied');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000010","role":"authenticated","role_name":"owner_admin"}';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000010';
select is((select count(*) from public.app_users), 0::bigint,
  'an Owner/Admin-shaped JWT claim remains default-denied');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated","role_name":"manager"}';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
select is((select count(*) from public.app_users), 0::bigint,
  'an unprovisioned-Manager-shaped JWT claim remains default-denied');
reset role;

set local role service_role;
select is(
  (select count(*) from public.app_users where email = 'rls-probe@example.invalid'),
  1::bigint,
  'service_role can read through the server-only RLS bypass'
);
select lives_ok(
  $sql$
    insert into public.app_users (email, role)
    values ('rls-service-role@example.invalid', 'rep')
  $sql$,
  'service_role retains the DML needed by server handlers'
);
reset role;

-- A future migration must explicitly opt every object into server access.
create table public.phase0_future_table_probe (
  id bigint generated always as identity primary key
);
create function public.phase0_future_function_probe()
returns integer
language sql
immutable
as $function$ select 1 $function$;

select ok(
  not has_table_privilege('anon', 'public.phase0_future_table_probe', 'SELECT')
    and not has_table_privilege('authenticated', 'public.phase0_future_table_probe', 'SELECT')
    and not has_table_privilege('service_role', 'public.phase0_future_table_probe', 'SELECT'),
  'future tables start inaccessible to every API role'
);

select ok(
  not has_sequence_privilege('anon', 'public.phase0_future_table_probe_id_seq', 'USAGE')
    and not has_sequence_privilege('authenticated', 'public.phase0_future_table_probe_id_seq', 'USAGE')
    and not has_sequence_privilege('service_role', 'public.phase0_future_table_probe_id_seq', 'USAGE'),
  'future sequences start inaccessible to every API role'
);

select ok(
  not has_function_privilege('anon', 'public.phase0_future_function_probe()', 'EXECUTE'),
  'future functions start inaccessible to anon'
);

select ok(
  not has_function_privilege('authenticated', 'public.phase0_future_function_probe()', 'EXECUTE'),
  'future functions start inaccessible to authenticated'
);

select ok(
  not has_function_privilege('service_role', 'public.phase0_future_function_probe()', 'EXECUTE'),
  'future functions start inaccessible to service_role until explicitly reviewed'
);

select * from finish();
rollback;
