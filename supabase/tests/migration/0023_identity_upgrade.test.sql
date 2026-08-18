begin;

create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;

select no_plan();

select is(
  (
    select employee.id
    from public.ops_employees as employee
    join public.ops_employee_auth_identities as auth_identity
      on auth_identity.employee_id = employee.id
    where auth_identity.auth_user_id = 'a1000000-0000-4000-8000-000000000001'
      and auth_identity.state = 'active'
  ),
  'a2000000-0000-4000-8000-000000000001'::uuid,
  'the legacy Office app_users UUID is preserved as the canonical employee UUID'
);

select is(
  (
    select employee.id
    from public.ops_employees as employee
    join public.ops_employee_auth_identities as auth_identity
      on auth_identity.employee_id = employee.id
    where auth_identity.auth_user_id = 'a1000000-0000-4000-8000-000000000002'
      and auth_identity.state = 'active'
  ),
  'a2000000-0000-4000-8000-000000000002'::uuid,
  'the legacy Owner app_users UUID is preserved as the canonical employee UUID'
);

select is(
  (
    select count(*)::bigint
    from public.ops_employee_auth_identities
    where employee_id in (
      'a2000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000002'
    )
      and state = 'active'
      and entity_version = 1
      and revoked_at is null
  ),
  2::bigint,
  'each legacy employee receives one active version-1 Auth identity link'
);

select is(
  (
    select compatibility_email
    from public.ops_employees
    where id = 'a2000000-0000-4000-8000-000000000001'
  ),
  'legacy-office@example.invalid',
  'the compatibility email is normalized during backfill'
);

select is(
  (
    select role
    from public.ops_employees
    where id = 'a2000000-0000-4000-8000-000000000001'
  ),
  'office',
  'the legacy rep role becomes canonical Office'
);

select is(
  (
    select count(*)::bigint
    from public.ops_employee_department_memberships as membership
    join public.ops_departments as department
      on department.id = membership.department_id
    where membership.employee_id = 'a2000000-0000-4000-8000-000000000001'
      and membership.state = 'active'
      and membership.membership_version = 1
      and department.slug = 'office'
  ),
  1::bigint,
  'the legacy Office employee receives exactly one Office membership at version 1'
);

select set_eq(
  $sql$
    select department.slug
    from public.ops_employee_department_memberships as membership
    join public.ops_departments as department
      on department.id = membership.department_id
    where membership.employee_id = 'a2000000-0000-4000-8000-000000000002'
      and membership.state = 'active'
      and membership.membership_version = 1
  $sql$,
  $sql$
    values ('office'::text), ('advertising'::text), ('installer'::text)
  $sql$,
  'the legacy Owner receives all three employee-department memberships'
);

select is(
  (
    select count(*)::bigint
    from public.ops_identity_audit_events
    where employee_id in (
      'a2000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000002'
    )
      and event_type = 'legacy_identity_backfilled'
      and reason = 'migration_0023_identity_foundation'
  ),
  2::bigint,
  'each legacy identity backfill has one audit event'
);

select is(
  (
    select claimed_employee_id
    from public.leads
    where id = 'a3000000-0000-4000-8000-000000000001'
  ),
  'a2000000-0000-4000-8000-000000000001'::uuid,
  'lead ownership keeps the exact employee UUID through the FK transition'
);

select is(
  (
    select rep_employee_id
    from public.calls
    where id = 'a4000000-0000-4000-8000-000000000001'
  ),
  'a2000000-0000-4000-8000-000000000001'::uuid,
  'call ownership keeps the exact employee UUID through the FK transition'
);

select is(
  (
    select namespace.nspname || '.' || relation.relname
    from pg_constraint as constraint_record
    join pg_class as relation on relation.oid = constraint_record.confrelid
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where constraint_record.conrelid = 'public.leads'::regclass
      and constraint_record.conname = 'leads_claimed_employee_id_fkey'
      and constraint_record.convalidated
  ),
  'public.ops_employees',
  'the upgraded lead ownership FK is validated against ops_employees'
);

select is(
  (
    select namespace.nspname || '.' || relation.relname
    from pg_constraint as constraint_record
    join pg_class as relation on relation.oid = constraint_record.confrelid
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where constraint_record.conrelid = 'public.calls'::regclass
      and constraint_record.conname = 'calls_rep_employee_id_fkey'
      and constraint_record.convalidated
  ),
  'public.ops_employees',
  'the upgraded call ownership FK is validated against ops_employees'
);

select is(
  (
    select count(*)::bigint
    from public.app_users as compatibility_user
    join public.ops_employees as employee
      on employee.id = compatibility_user.id
    where compatibility_user.id in (
      'a2000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000002'
    )
      and compatibility_user.email = employee.compatibility_email
      and compatibility_user.role = employee.role
      and compatibility_user.created_at = employee.created_at
  ),
  2::bigint,
  'legacy app_users rows become exact active-linked compatibility projections'
);

select throws_ok(
  $sql$
    update public.app_users
    set role = 'admin'
    where id = 'a2000000-0000-4000-8000-000000000001'
  $sql$,
  '23514',
  'app_users write does not match its authoritative ops_employee',
  'the upgraded compatibility projection rejects role drift'
);

update public.ops_employees
set
  active = false,
  deactivated_at = clock_timestamp(),
  entity_version = entity_version + 1,
  updated_at = clock_timestamp()
where id = 'a2000000-0000-4000-8000-000000000001';

select is(
  (
    select count(*)::bigint
    from public.app_users
    where id = 'a2000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'deactivation removes the upgraded employee from legacy authorization'
);

select is(
  (
    select count(*)::bigint
    from public.leads
    where claimed_employee_id = 'a2000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'historical lead ownership remains valid after employee deactivation'
);

select is(
  (
    select count(*)::bigint
    from public.calls
    where rep_employee_id = 'a2000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'historical call ownership remains valid after employee deactivation'
);

select * from finish();
rollback;
