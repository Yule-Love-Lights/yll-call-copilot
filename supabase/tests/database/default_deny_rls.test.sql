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
  ('live_segments'),
  ('live_sessions'),
  ('offer_versions'),
  ('ops_departments'),
  ('ops_employee_auth_identities'),
  ('ops_employee_department_memberships'),
  ('ops_employee_external_identities'),
  ('ops_identity_link_requests'),
  ('ops_employees'),
  ('ops_identity_audit_events'),
  ('ops_task_events'),
  ('ops_tasks'),
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

create temporary table expected_hub_routines (
  routine_signature text primary key
) on commit drop;

insert into expected_hub_routines (routine_signature) values
  ('abandon_owned_live_attempt(uuid,text,uuid)'),
  ('advance_recording_sync_cursor(timestamp with time zone,jsonb)'),
  ('append_authorized_live_segment(uuid,uuid,text,text,integer,integer)'),
  ('assert_legacy_metric_artifacts_reconciled()'),
  ('assert_personal_touch_metric_provenance()'),
  ('begin_owned_followup_send(uuid,text,uuid,uuid)'),
  ('call_commitments_upsert_batch(uuid,jsonb)'),
  ('call_commitments_finalize_extraction(uuid,jsonb,text)'),
  ('complete_owned_lead_call(uuid,text,text,uuid,uuid,uuid,text,text,text,text,boolean)'),
  ('consume_authorized_live_dial(text,text,text,text,text,text)'),
  ('consume_authorized_live_stream(uuid,text)'),
  ('decide_queued_lead(uuid,text,text,uuid,text,text,boolean,text)'),
  ('end_owned_live_attempt(uuid,text,uuid)'),
  ('enforce_call_metric_scope()'),
  ('enforce_call_score_metric_scope()'),
  ('enforce_followup_provider_message_immutable()'),
  ('enforce_live_session_transition()'),
  ('enforce_ops_employee_auth_identity_transition()'),
  ('enforce_ops_employee_external_identity_transition()'),
  ('enforce_ops_employee_identity_immutability()'),
  ('enforce_ops_task_transition()'),
  ('enforce_transcript_metric_scope()'),
  ('finish_owned_followup_send(uuid,text,uuid,uuid,text,text)'),
  ('guard_app_users_projection()'),
  ('is_contact_calling_time_allowed(timestamp with time zone,text)'),
  ('link_quote_tool_employee_identity(uuid,uuid,text)'),
  ('owner_link_quote_tool_employee_identity(uuid,uuid,uuid,text,uuid)'),
  ('ops_create_manual_task(text,text,timestamp with time zone,uuid,uuid)'),
  ('ops_update_own_task(uuid,text,text,uuid,uuid)'),
  ('revoke_quote_tool_employee_identity(uuid,uuid,text)'),
  ('provision_legacy_office_employee(uuid,text,text)'),
  ('record_commitment_extraction_failure(uuid,text)'),
  ('reject_live_segment_mutation()'),
  ('reject_ops_identity_audit_event_mutation()'),
  ('reject_ops_task_event_mutation()'),
  ('start_claimed_live_attempt(uuid,text,text,uuid,text,uuid)'),
  ('sync_app_user_projection()'),
  ('update_owned_followup_draft(uuid,text,uuid,text,text)');

select set_eq(
  $sql$
    select routine.oid::regprocedure::text
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
  $sql$ select routine_signature from expected_hub_routines $sql$,
  'the reviewed public-routine manifest is exact'
);

create temporary table expected_hub_triggers (
  trigger_signature text primary key
) on commit drop;

insert into expected_hub_triggers (trigger_signature) values
  ('call_scores.enforce_call_score_metric_scope'),
  ('calls.enforce_call_metric_scope'),
  ('followups.enforce_followup_provider_message_immutable'),
  ('live_segments.reject_live_segment_mutation'),
  ('live_sessions.enforce_live_session_transition'),
  ('ops_employee_auth_identities.enforce_ops_employee_auth_identity_transition'),
  ('ops_employee_auth_identities.sync_app_user_projection'),
  ('ops_employee_external_identities.enforce_ops_employee_external_identity_transition'),
  ('app_users.guard_app_users_projection'),
  ('ops_employees.enforce_ops_employee_identity_immutability'),
  ('ops_employees.sync_app_user_projection'),
  ('ops_identity_audit_events.reject_ops_identity_audit_event_mutation'),
  ('ops_task_events.reject_ops_task_event_mutation'),
  ('ops_tasks.enforce_ops_task_transition'),
  ('transcripts.enforce_transcript_metric_scope');

select set_eq(
  $sql$
    select format('%I.%I', relation.relname, trigger_record.tgname)
    from pg_trigger trigger_record
    join pg_class relation on relation.oid = trigger_record.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and not trigger_record.tgisinternal
  $sql$,
  $sql$ select trigger_signature from expected_hub_triggers $sql$,
  'the reviewed public-trigger manifest is exact'
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
  case
    when table_name = 'app_users' then
      has_table_privilege('service_role', 'public.app_users', 'SELECT')
        and not has_table_privilege('service_role', 'public.app_users', 'INSERT')
        and not has_table_privilege('service_role', 'public.app_users', 'UPDATE')
        and not has_table_privilege('service_role', 'public.app_users', 'DELETE')
        and not has_table_privilege('service_role', 'public.app_users', 'TRUNCATE')
        and not has_table_privilege('service_role', 'public.app_users', 'REFERENCES')
        and not has_table_privilege('service_role', 'public.app_users', 'TRIGGER')
        and not has_table_privilege('service_role', 'public.app_users', 'MAINTAIN')
        and has_column_privilege('service_role', 'public.app_users', 'id', 'UPDATE')
        and not has_column_privilege('service_role', 'public.app_users', 'email', 'UPDATE')
        and not has_column_privilege('service_role', 'public.app_users', 'role', 'UPDATE')
        and not has_column_privilege('service_role', 'public.app_users', 'created_at', 'UPDATE')
        and not has_any_column_privilege('service_role', 'public.app_users', 'INSERT')
        and not has_any_column_privilege('service_role', 'public.app_users', 'REFERENCES')
    when table_name in (
      'ops_departments',
      'ops_employee_auth_identities',
      'ops_employee_department_memberships',
      'ops_employee_external_identities',
      'ops_identity_link_requests',
      'ops_employees',
      'ops_identity_audit_events',
      'ops_task_events',
      'ops_tasks'
    ) then
      has_table_privilege('service_role', format('public.%I', table_name), 'SELECT')
        and not has_table_privilege('service_role', format('public.%I', table_name), 'INSERT')
        and not has_table_privilege('service_role', format('public.%I', table_name), 'UPDATE')
        and not has_table_privilege('service_role', format('public.%I', table_name), 'DELETE')
        and not has_table_privilege('service_role', format('public.%I', table_name), 'TRUNCATE')
        and not has_table_privilege('service_role', format('public.%I', table_name), 'REFERENCES')
        and not has_table_privilege('service_role', format('public.%I', table_name), 'TRIGGER')
        and not has_table_privilege('service_role', format('public.%I', table_name), 'MAINTAIN')
    when table_name = 'live_segments' then
      has_table_privilege('service_role', 'public.live_segments', 'SELECT')
        and has_table_privilege('service_role', 'public.live_segments', 'INSERT')
        and not has_table_privilege('service_role', 'public.live_segments', 'UPDATE')
        and not has_table_privilege('service_role', 'public.live_segments', 'DELETE')
        and not has_table_privilege('service_role', 'public.live_segments', 'TRUNCATE')
        and not has_table_privilege('service_role', 'public.live_segments', 'REFERENCES')
        and not has_table_privilege('service_role', 'public.live_segments', 'TRIGGER')
        and not has_table_privilege('service_role', 'public.live_segments', 'MAINTAIN')
    else
      has_table_privilege('service_role', format('public.%I', table_name), 'SELECT')
        and has_table_privilege('service_role', format('public.%I', table_name), 'INSERT')
        and has_table_privilege('service_role', format('public.%I', table_name), 'UPDATE')
        and has_table_privilege('service_role', format('public.%I', table_name), 'DELETE')
        and not has_table_privilege('service_role', format('public.%I', table_name), 'TRUNCATE')
        and not has_table_privilege('service_role', format('public.%I', table_name), 'REFERENCES')
        and not has_table_privilege('service_role', format('public.%I', table_name), 'TRIGGER')
        and not has_table_privilege('service_role', format('public.%I', table_name), 'MAINTAIN')
  end,
  format('service_role has only the reviewed privileges on %I', table_name)
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

insert into auth.users (
  id,
  email,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new
)
values (
  '00000000-0000-4000-8000-000000000101',
  'rls-probe@example.invalid',
  '',
  '',
  '',
  ''
);

insert into public.ops_employees (
  id,
  compatibility_email,
  role,
  active,
  membership_version,
  entity_version
) values (
  '00000000-0000-4000-8000-000000000201',
  'rls-probe@example.invalid',
  'office',
  true,
  1,
  1
);

insert into public.ops_employee_auth_identities (
  employee_id,
  auth_user_id,
  state,
  entity_version,
  effective_at
) values (
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000101',
  'active',
  1,
  now()
);

insert into public.ops_employee_department_memberships (
  employee_id,
  department_id,
  state,
  membership_version,
  effective_at
) values (
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000001',
  'active',
  1,
  now()
);

-- These transaction-local grants prove the RLS layer independently of the
-- ACL layer. They disappear on rollback.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.app_users
  to anon, authenticated;

-- Isolate the RLS assertion from the compatibility-projection guard. The
-- trigger is tested separately below and otherwise rejects the probe first.
alter table public.app_users disable trigger guard_app_users_projection;

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

reset role;
alter table public.app_users enable trigger guard_app_users_projection;
set local role authenticated;

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

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000012","role":"authenticated","departments":["office","installer"],"membership_version":2}';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000012';
select is((select count(*) from public.app_users), 0::bigint,
  'a current multi-membership-shaped JWT claim remains default-denied');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated","employee_id":null}';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select is((select count(*) from public.app_users), 0::bigint,
  'an unlinked-identity-shaped JWT claim remains default-denied');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000013","role":"authenticated","auth_link_state":"revoked"}';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000013';
select is((select count(*) from public.app_users), 0::bigint,
  'a revoked-Auth-link-shaped JWT claim remains default-denied');

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

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000010","role":"authenticated","role_name":"owner"}';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000010';
select is((select count(*) from public.app_users), 0::bigint,
  'an Owner-shaped JWT claim remains default-denied');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated","role_name":"admin"}';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000014';
select is((select count(*) from public.app_users), 0::bigint,
  'an Admin-shaped JWT claim remains default-denied');

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
select throws_ok(
  $sql$
    insert into public.app_users (email, role)
    values ('rls-service-role@example.invalid', 'rep')
  $sql$,
  '42501',
  null,
  'service_role cannot insert compatibility projection rows directly'
);
select throws_ok(
  $sql$
    update public.app_users
    set
      email = 'rls-service-role@example.invalid',
      role = 'admin',
      created_at = clock_timestamp()
    where id = '00000000-0000-4000-8000-000000000201'
  $sql$,
  '42501',
  null,
  'service_role cannot update compatibility projection data directly'
);
select throws_ok(
  $sql$
    delete from public.app_users
    where id = '00000000-0000-4000-8000-000000000201'
  $sql$,
  '42501',
  null,
  'service_role cannot delete compatibility projection rows directly'
);
select throws_ok(
  $sql$
    update public.app_users
    set id = '00000000-0000-4000-8000-000000000202'
    where id = '00000000-0000-4000-8000-000000000201'
  $sql$,
  '23514',
  'app_users.id is immutable',
  'the narrow row-lock column grant cannot change a projection key'
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
