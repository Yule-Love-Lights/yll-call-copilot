begin;

create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;

select no_plan();

create temporary view identity_test_current_employees as
select
  employee.*,
  auth_identity.id as auth_identity_id,
  auth_identity.auth_user_id,
  auth_identity.entity_version as auth_entity_version,
  auth_identity.effective_at as auth_effective_at
from public.ops_employees as employee
join public.ops_employee_auth_identities as auth_identity
  on auth_identity.employee_id = employee.id
 and auth_identity.state = 'active';

-- Later assertions deliberately impersonate service_role. Grant that role
-- access to this transaction-local test helper only.
grant select on identity_test_current_employees to service_role;

select set_eq(
  $sql$
    select slug
    from public.ops_departments
  $sql$,
  $sql$
    values ('office'::text), ('advertising'::text), ('installer'::text)
  $sql$,
  'the V1 employee-department vocabulary is exactly Office, Advertising, and Installer'
);

select is(
  (select count(*)::bigint from public.ops_departments where slug = 'management'),
  0::bigint,
  'Management is not an employee department'
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
      and constraint_record.confdeltype = 'r'
  ),
  'public.ops_employees',
  'lead employee ownership now references the authoritative employee table'
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
      and constraint_record.confdeltype = 'r'
  ),
  'public.ops_employees',
  'call employee ownership now references the authoritative employee table'
);

select ok(
  (
    select routine.prosecdef
    from pg_proc as routine
    where routine.oid =
      'public.provision_legacy_office_employee(uuid,text,text)'::regprocedure
  ),
  'legacy Office provisioning is SECURITY DEFINER'
);

select ok(
  (
    select coalesce(routine.proconfig, array[]::text[])
      @> array['search_path=""']::text[]
    from pg_proc as routine
    where routine.oid =
      'public.provision_legacy_office_employee(uuid,text,text)'::regprocedure
  ),
  'legacy Office provisioning has an empty search_path'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.provision_legacy_office_employee(uuid,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.provision_legacy_office_employee(uuid,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.provision_legacy_office_employee(uuid,text,text)',
    'EXECUTE'
  ),
  'only service_role can invoke legacy Office provisioning'
);

select ok(
  (
    select routine.prosecdef
    from pg_proc as routine
    where routine.oid =
      'public.link_quote_tool_employee_identity(uuid,uuid,text)'::regprocedure
  )
  and (
    select routine.prosecdef
    from pg_proc as routine
    where routine.oid =
      'public.revoke_quote_tool_employee_identity(uuid,uuid,text)'::regprocedure
  )
  and (
    select coalesce(routine.proconfig, array[]::text[])
      @> array['search_path=""']::text[]
    from pg_proc as routine
    where routine.oid =
      'public.link_quote_tool_employee_identity(uuid,uuid,text)'::regprocedure
  )
  and (
    select coalesce(routine.proconfig, array[]::text[])
      @> array['search_path=""']::text[]
    from pg_proc as routine
    where routine.oid =
      'public.revoke_quote_tool_employee_identity(uuid,uuid,text)'::regprocedure
  )
  and has_function_privilege(
    'service_role',
    'public.link_quote_tool_employee_identity(uuid,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.link_quote_tool_employee_identity(uuid,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.link_quote_tool_employee_identity(uuid,uuid,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.revoke_quote_tool_employee_identity(uuid,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.revoke_quote_tool_employee_identity(uuid,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.revoke_quote_tool_employee_identity(uuid,uuid,text)',
    'EXECUTE'
  ),
  'only service_role can invoke the Quote Tool identity bridge routines'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.sync_app_user_projection()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.guard_app_users_projection()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.enforce_ops_employee_identity_immutability()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.enforce_ops_employee_auth_identity_transition()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.enforce_ops_employee_external_identity_transition()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.reject_ops_identity_audit_event_mutation()',
    'EXECUTE'
  ),
  'trigger functions cannot be called directly by service_role'
);

select ok(
  has_table_privilege('service_role', 'public.ops_employees', 'SELECT')
  and not has_table_privilege('service_role', 'public.ops_employees', 'INSERT')
  and not has_table_privilege('service_role', 'public.ops_employees', 'UPDATE')
  and not has_table_privilege('service_role', 'public.ops_employees', 'DELETE')
  and has_table_privilege(
    'service_role',
    'public.ops_employee_auth_identities',
    'SELECT'
  )
  and not has_table_privilege(
    'service_role',
    'public.ops_employee_auth_identities',
    'INSERT'
  )
  and has_table_privilege(
    'service_role',
    'public.ops_employee_external_identities',
    'SELECT'
  )
  and not has_table_privilege(
    'service_role',
    'public.ops_employee_external_identities',
    'INSERT'
  )
  and has_table_privilege(
    'service_role',
    'public.ops_employee_department_memberships',
    'SELECT'
  )
  and not has_table_privilege(
    'service_role',
    'public.ops_employee_department_memberships',
    'INSERT'
  ),
  'service_role reads identity snapshots but cannot mutate their tables directly'
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
  '91000000-0000-4000-8000-000000000001',
  'office-provision@example.invalid',
  '',
  '',
  '',
  ''
);

set local role service_role;
select is(
  (
    select count(*)::bigint
    from public.provision_legacy_office_employee(
      '91000000-0000-4000-8000-000000000001',
      ' Office-Provision@Example.Invalid ',
      'identity foundation pgTAP'
    )
  ),
  1::bigint,
  'service_role provisions one canonical Office identity atomically'
);
reset role;

select is(
  (
    select compatibility_email
    from identity_test_current_employees
    where auth_user_id = '91000000-0000-4000-8000-000000000001'
  ),
  'office-provision@example.invalid',
  'legacy Office provisioning normalizes the compatibility email'
);

select is(
  (
    select role
    from identity_test_current_employees
    where auth_user_id = '91000000-0000-4000-8000-000000000001'
  ),
  'office',
  'legacy Office provisioning cannot choose an elevated or field role'
);

select is(
  (
    select count(*)::bigint
    from public.ops_employee_department_memberships as membership
    join public.ops_departments as department
      on department.id = membership.department_id
    join identity_test_current_employees as current_identity
      on current_identity.id = membership.employee_id
    where current_identity.auth_user_id = '91000000-0000-4000-8000-000000000001'
      and department.slug = 'office'
      and membership.state = 'active'
      and membership.membership_version = 1
      and membership.revoked_at is null
  ),
  1::bigint,
  'provisioning creates exactly one effective Office membership at version 1'
);

select is(
  (
    select count(*)::bigint
    from public.ops_identity_audit_events as audit_event
    join identity_test_current_employees as current_identity
      on current_identity.id = audit_event.employee_id
    where current_identity.auth_user_id = '91000000-0000-4000-8000-000000000001'
      and audit_event.event_type = 'legacy_office_provisioned'
      and audit_event.reason = 'identity foundation pgTAP'
  ),
  1::bigint,
  'provisioning records one nonblank append-only audit event'
);

set local role service_role;
select is(
  (
    select count(*)::bigint
    from public.link_quote_tool_employee_identity(
      (
        select id
        from identity_test_current_employees
        where auth_user_id = '91000000-0000-4000-8000-000000000001'
      ),
      '92000000-0000-4000-8000-000000000001',
      'Quote Tool shared-identity pgTAP'
    )
  ),
  1::bigint,
  'service_role links one active Quote Tool identity to an existing Hub employee'
);
reset role;

select is(
  (
    select count(*)::bigint
    from public.ops_employee_external_identities as identity_record
    join identity_test_current_employees as current_identity
      on current_identity.id = identity_record.employee_id
    where current_identity.auth_user_id = '91000000-0000-4000-8000-000000000001'
      and identity_record.issuer = 'quote_tool'
      and identity_record.subject_user_id = '92000000-0000-4000-8000-000000000001'
      and identity_record.state = 'active'
      and identity_record.revoked_at is null
  ),
  1::bigint,
  'the Quote Tool identity bridge stores only the external UUID and issuer'
);

select is(
  (
    select count(*)::bigint
    from public.ops_identity_audit_events as audit_event
    where audit_event.event_type = 'auth_identity_linked'
      and audit_event.reason = 'Quote Tool shared-identity pgTAP'
      and audit_event.detail ->> 'identity_source' = 'quote_tool'
  ),
  1::bigint,
  'the Quote Tool identity link is auditable'
);

set local role service_role;
select is(
  (
    select count(*)::bigint
    from public.link_quote_tool_employee_identity(
      (
        select id
        from identity_test_current_employees
        where auth_user_id = '91000000-0000-4000-8000-000000000001'
      ),
      '92000000-0000-4000-8000-000000000001',
      'Quote Tool shared-identity exact retry pgTAP'
    )
  ),
  1::bigint,
  'an exact Quote Tool identity-link retry is idempotent'
);
reset role;

select is(
  (
    select count(*)::bigint
    from public.ops_employee_external_identities
    where issuer = 'quote_tool'
      and subject_user_id = '92000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the exact retry cannot create a second external identity row'
);

set local role service_role;
select is(
  (
    select state
    from public.revoke_quote_tool_employee_identity(
      (
        select id
        from identity_test_current_employees
        where auth_user_id = '91000000-0000-4000-8000-000000000001'
      ),
      '92000000-0000-4000-8000-000000000001',
      'Quote Tool shared-identity revocation pgTAP'
    )
  ),
  'revoked',
  'service_role can revoke the external identity through the audited routine'
);
reset role;

select is(
  (
    select count(*)::bigint
    from public.ops_identity_audit_events as audit_event
    where audit_event.event_type = 'auth_identity_revoked'
      and audit_event.reason = 'Quote Tool shared-identity revocation pgTAP'
      and audit_event.detail ->> 'identity_source' = 'quote_tool'
  ),
  1::bigint,
  'the Quote Tool identity revocation is auditable'
);

set local role service_role;
select is(
  (
    select count(*)::bigint
    from public.link_quote_tool_employee_identity(
      (
        select id
        from identity_test_current_employees
        where auth_user_id = '91000000-0000-4000-8000-000000000001'
      ),
      '92000000-0000-4000-8000-000000000002',
      'Quote Tool shared-identity replacement pgTAP'
    )
  ),
  1::bigint,
  'a revoked Quote Tool identity can be replaced through the audited routine'
);
reset role;

select is(
  (
    select entity_version
    from public.ops_employee_external_identities
    where issuer = 'quote_tool'
      and subject_user_id = '92000000-0000-4000-8000-000000000002'
  ),
  3::bigint,
  'a replacement external identity advances the employee issuer history version'
);

select is(
  (
    select count(*)::bigint
    from public.app_users as compatibility_user
    join identity_test_current_employees as current_identity
      on current_identity.id = compatibility_user.id
    where current_identity.auth_user_id = '91000000-0000-4000-8000-000000000001'
      and compatibility_user.email = current_identity.compatibility_email
      and compatibility_user.role = current_identity.role
      and compatibility_user.created_at = current_identity.created_at
  ),
  1::bigint,
  'an active linked Office employee has one exact compatibility projection row'
);

select is(
  (
    select count(*)::bigint
    from public.provision_legacy_office_employee(
      '91000000-0000-4000-8000-000000000001',
      'office-provision@example.invalid',
      'exact retry must not write a second audit event'
    )
  ),
  1::bigint,
  'an exact provisioning retry returns the existing employee'
);

select is(
  (
    select count(*)::bigint
    from public.ops_identity_audit_events as audit_event
    join identity_test_current_employees as current_identity
      on current_identity.id = audit_event.employee_id
    where current_identity.auth_user_id = '91000000-0000-4000-8000-000000000001'
      and audit_event.event_type = 'legacy_office_provisioned'
  ),
  1::bigint,
  'an exact provisioning retry is idempotent and does not duplicate audit'
);

select throws_ok(
  $sql$
    select *
    from public.provision_legacy_office_employee(
      '91000000-0000-4000-8000-000000000001',
      'changed@example.invalid',
      'mismatched retry'
    )
  $sql$,
  '23514',
  'Supabase Auth UUID and compatibility email do not match',
  'a changed email cannot reuse an immutable Auth UUID'
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
  '91000000-0000-4000-8000-000000000002',
  'OFFICE-PROVISION@EXAMPLE.INVALID',
  '',
  '',
  '',
  ''
);

set local role service_role;
select throws_ok(
  $sql$
    select *
    from public.provision_legacy_office_employee(
      '91000000-0000-4000-8000-000000000002',
      'office-provision@example.invalid',
      'changed Auth identity retry'
    )
  $sql$,
  '23505',
  'Existing employee identity conflicts with requested Auth link',
  'a compatibility email cannot be moved to another Auth UUID'
);
reset role;

select throws_ok(
  $sql$
    select *
    from public.provision_legacy_office_employee(
      '91000000-0000-4000-8000-000000000001',
      'office-provision@example.invalid',
      '   '
    )
  $sql$,
  '22023',
  'auth UUID, normalized email, and nonblank reason are required',
  'provisioning refuses an unauditable blank reason'
);

select throws_ok(
  $sql$
    update public.app_users
    set email = 'projection-drift@example.invalid'
    where email = 'office-provision@example.invalid'
  $sql$,
  '23514',
  'app_users write does not match its authoritative ops_employee',
  'direct compatibility projection drift is rejected'
);

select throws_ok(
  $sql$
    delete from public.app_users
    where email = 'office-provision@example.invalid'
  $sql$,
  '23514',
  'app_users is a protected active-employee projection',
  'an active linked employee projection cannot be deleted directly'
);

select throws_ok(
  $sql$
    update public.ops_employees
    set
      compatibility_email = 'changed-compatibility@example.invalid',
      entity_version = entity_version + 1,
      updated_at = clock_timestamp()
    where id = (
      select employee_id
      from public.ops_employee_auth_identities
      where auth_user_id = '91000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514',
  'ops_employees.compatibility_email is immutable',
  'compatibility email cannot split current access from legacy attribution'
);

insert into public.leads (
  id,
  full_name,
  phone,
  reason,
  source,
  status,
  timezone
) values (
  '92000000-0000-4000-8000-000000000001',
  'Identity Projection Test',
  '+15555559101',
  'identity projection authorization test',
  'inbound',
  'queued',
  'UTC'
);

set local role service_role;
select is(
  (
    select result_code
    from public.decide_queued_lead(
      (
        select id
        from identity_test_current_employees
        where auth_user_id = '91000000-0000-4000-8000-000000000001'
      ),
      '91000000-0000-4000-8000-000000000001',
      'office-provision@example.invalid',
      '92000000-0000-4000-8000-000000000001',
      'dismiss',
      null,
      false,
      null
    )
  ),
  'dismissed',
  'the narrow app_users UPDATE(id) grant preserves the enabled 0020 actor lock'
);
reset role;

update public.ops_employees
set
  active = false,
  deactivated_at = clock_timestamp(),
  entity_version = entity_version + 1,
  updated_at = clock_timestamp()
where id = (
  select employee_id
  from public.ops_employee_auth_identities
  where auth_user_id = '91000000-0000-4000-8000-000000000001'
);

select is(
  (
    select count(*)::bigint
    from public.app_users
    where email = 'office-provision@example.invalid'
  ),
  0::bigint,
  'deactivation transactionally removes the compatibility projection'
);

set local role service_role;
select is(
  (
    select result_code
    from public.decide_queued_lead(
      (
        select id
        from identity_test_current_employees
        where auth_user_id = '91000000-0000-4000-8000-000000000001'
      ),
      '91000000-0000-4000-8000-000000000001',
      'office-provision@example.invalid',
      '92000000-0000-4000-8000-000000000001',
      'claim',
      null,
      false,
      null
    )
  ),
  'actor_inactive',
  'an existing 0020 actor RPC denies immediately after authoritative deactivation'
);
reset role;

update public.ops_employees
set
  active = true,
  deactivated_at = null,
  entity_version = entity_version + 1,
  effective_at = clock_timestamp(),
  updated_at = clock_timestamp()
where id = (
  select employee_id
  from public.ops_employee_auth_identities
  where auth_user_id = '91000000-0000-4000-8000-000000000001'
);

select is(
  (
    select count(*)::bigint
    from public.app_users
    where email = 'office-provision@example.invalid'
      and role = 'office'
  ),
  1::bigint,
  'reactivation recreates the exact compatibility projection'
);

select throws_ok(
  $sql$
    update public.ops_employee_auth_identities
    set auth_user_id = '91000000-0000-4000-8000-000000000002'
    where auth_user_id = '91000000-0000-4000-8000-000000000001'
  $sql$,
  '23514',
  'employee/Auth UUID linkage and effective time are immutable',
  'a historical Auth UUID link cannot be exchanged in place'
);

update public.ops_employee_auth_identities
set
  state = 'revoked',
  revoked_at = clock_timestamp(),
  entity_version = entity_version + 1,
  updated_at = clock_timestamp()
where auth_user_id = '91000000-0000-4000-8000-000000000001';

select lives_ok(
  $sql$
    insert into public.ops_identity_audit_events (
      employee_id,
      event_type,
      effective_at,
      reason
    )
    select
      employee_id,
      'auth_identity_revoked',
      revoked_at,
      'identity foundation vocabulary proof only'
    from public.ops_employee_auth_identities
    where auth_user_id = '91000000-0000-4000-8000-000000000001'
  $sql$,
  'the closed audit vocabulary reserves Auth-identity revocation for PR2'
);

select is(
  (
    select count(*)::bigint
    from public.app_users
    where email = 'office-provision@example.invalid'
  ),
  0::bigint,
  'revoking the active Auth link removes the compatibility projection'
);

set local role service_role;
select is(
  (
    select result_code
    from public.decide_queued_lead(
      (
        select employee_id
        from public.ops_employee_auth_identities
        where auth_user_id = '91000000-0000-4000-8000-000000000001'
      ),
      '91000000-0000-4000-8000-000000000001',
      'office-provision@example.invalid',
      '92000000-0000-4000-8000-000000000001',
      'claim',
      null,
      false,
      null
    )
  ),
  'actor_inactive',
  'an existing 0020 actor RPC denies immediately after Auth-link revocation'
);

select throws_ok(
  $sql$
    select *
    from public.provision_legacy_office_employee(
      '91000000-0000-4000-8000-000000000001',
      'office-provision@example.invalid',
      'revoked retry'
    )
  $sql$,
  '23514',
  'Existing employee Auth identity is revoked',
  'legacy provisioning cannot reactivate a revoked Auth UUID'
);
reset role;

insert into auth.users (
  id,
  phone,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new
) values (
  '91000000-0000-4000-8000-000000000003',
  '+15555559103',
  '',
  '',
  '',
  ''
);

insert into public.ops_employee_auth_identities (
  employee_id,
  auth_user_id,
  state,
  entity_version,
  effective_at
)
select
  employee_id,
  '91000000-0000-4000-8000-000000000003',
  'active',
  3,
  clock_timestamp()
from public.ops_employee_auth_identities
where auth_user_id = '91000000-0000-4000-8000-000000000001';

select is(
  (
    select count(*)::bigint
    from identity_test_current_employees
    where auth_user_id = '91000000-0000-4000-8000-000000000003'
      and compatibility_email = 'office-provision@example.invalid'
      and active
  ),
  1::bigint,
  'a new phone-only Auth UUID can become the sole active link for the same employee'
);

select set_eq(
  $sql$
    select auth_user_id, state, entity_version
    from public.ops_employee_auth_identities
    where employee_id = (
      select employee_id
      from public.ops_employee_auth_identities
      where auth_user_id = '91000000-0000-4000-8000-000000000003'
    )
  $sql$,
  $sql$
    values
      (
        '91000000-0000-4000-8000-000000000001'::uuid,
        'revoked'::text,
        2::bigint
      ),
      (
        '91000000-0000-4000-8000-000000000003'::uuid,
        'active'::text,
        3::bigint
      )
  $sql$,
  'Auth-link history retains the revoked UUID and advances the replacement version'
);

select throws_ok(
  $sql$
    insert into public.ops_employee_auth_identities (
      employee_id,
      auth_user_id,
      state,
      entity_version,
      effective_at
    )
    select
      employee_id,
      '91000000-0000-4000-8000-000000000002',
      'active',
      4,
      clock_timestamp()
    from public.ops_employee_auth_identities
    where auth_user_id = '91000000-0000-4000-8000-000000000003'
  $sql$,
  '23514',
  'employee already has an active Auth identity',
  'an employee cannot receive a second concurrent active Auth link'
);

select is(
  (
    select count(*)::bigint
    from public.app_users
    where email = 'office-provision@example.invalid'
      and role = 'office'
  ),
  1::bigint,
  'the replacement active Auth link restores the compatibility projection'
);

select throws_ok(
  $sql$
    update public.ops_employee_auth_identities
    set updated_at = clock_timestamp()
    where auth_user_id = '91000000-0000-4000-8000-000000000001'
  $sql$,
  '23514',
  'a revoked employee Auth identity is terminal',
  'revoked Auth-link history cannot be rewritten'
);

insert into public.ops_employees (
  id,
  compatibility_email,
  role,
  active,
  membership_version,
  entity_version
) values (
  '93000000-0000-4000-8000-000000000001',
  'unlinked-office@example.invalid',
  'office',
  true,
  1,
  1
);

insert into public.ops_employee_department_memberships (
  employee_id,
  department_id,
  state,
  membership_version,
  effective_at
) values (
  '93000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'active',
  1,
  now()
);

select is(
  (
    select count(*)::bigint
    from public.app_users
    where id = '93000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'an unlinked Office employee is not projected into legacy authorization'
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
  '93000000-0000-4000-8000-000000000002',
  'unlinked-office@example.invalid',
  '',
  '',
  '',
  ''
);

set local role service_role;
select is(
  (
    select employee_id
    from public.provision_legacy_office_employee(
      '93000000-0000-4000-8000-000000000002',
      'unlinked-office@example.invalid',
      'link pre-existing Office employee in identity foundation pgTAP'
    )
  ),
  '93000000-0000-4000-8000-000000000001'::uuid,
  'legacy provisioning links the existing compatible Office employee'
);
reset role;

select is(
  (
    select count(*)::bigint
    from public.app_users
    where id = '93000000-0000-4000-8000-000000000001'
      and email = 'unlinked-office@example.invalid'
      and role = 'office'
  ),
  1::bigint,
  'provisioning the first immutable Auth link creates the compatibility projection'
);

select is(
  (
    select count(*)::bigint
    from public.ops_identity_audit_events
    where employee_id = '93000000-0000-4000-8000-000000000001'
      and event_type = 'auth_identity_linked'
      and reason = 'link pre-existing Office employee in identity foundation pgTAP'
  ),
  1::bigint,
  'linking a pre-existing Office employee records one audited Auth-link event'
);

insert into auth.users (
  id,
  phone,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new
)
values (
  '94000000-0000-4000-8000-000000000001',
  '+15555559401',
  '',
  '',
  '',
  ''
);

select lives_ok(
  $sql$
    insert into public.ops_employees (
      id,
      compatibility_email,
      verified_phone_e164,
      role,
      active,
      membership_version,
      entity_version
    ) values (
      '94000000-0000-4000-8000-000000000002',
      null,
      '+15555559401',
      'advertising',
      true,
      1,
      1
    )
  $sql$,
  'a future phone-only Advertising identity is representable without email provisioning'
);

select lives_ok(
  $sql$
    insert into public.ops_employee_auth_identities (
      employee_id,
      auth_user_id,
      state,
      entity_version,
      effective_at
    ) values (
      '94000000-0000-4000-8000-000000000002',
      '94000000-0000-4000-8000-000000000001',
      'active',
      1,
      clock_timestamp()
    )
  $sql$,
  'a future phone-only Auth UUID is linked through versioned identity history'
);

select is(
  (
    select count(*)::bigint
    from public.app_users
    where id = '94000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'a field identity is never added to the Office/call compatibility projection'
);

update public.ops_employees
set
  membership_version = 3,
  entity_version = entity_version + 1,
  updated_at = clock_timestamp()
where id = '94000000-0000-4000-8000-000000000002';

insert into public.ops_employee_department_memberships (
  employee_id,
  department_id,
  state,
  membership_version,
  effective_at,
  revoked_at
) values
  (
    '94000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    'active',
    1,
    now() - interval '3 hours',
    null
  ),
  (
    '94000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'active',
    2,
    now() - interval '2 hours',
    null
  ),
  (
    '94000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    'revoked',
    3,
    now() - interval '2 hours',
    now() - interval '1 hour'
  );

select set_eq(
  $sql$
    select department.slug
    from public.ops_employee_department_memberships as membership
    join public.ops_departments as department
      on department.id = membership.department_id
     and department.active
    join public.ops_employees as employee
      on employee.id = membership.employee_id
    where membership.employee_id = '94000000-0000-4000-8000-000000000002'
      and membership.state = 'active'
      and membership.revoked_at is null
      and membership.effective_at <= now()
      and membership.membership_version <= employee.membership_version
  $sql$,
  $sql$
    values ('office'::text), ('advertising'::text)
  $sql$,
  'the current multi-membership snapshot excludes a revoked stale department'
);

select is(
  (
    select state
    from public.ops_employee_department_memberships
    where employee_id = '94000000-0000-4000-8000-000000000002'
      and department_id = '00000000-0000-4000-8000-000000000003'
      and membership_version = 3
  ),
  'revoked',
  'the stale Installer membership remains explicit historical state'
);

select lives_ok(
  $sql$
    insert into public.ops_employees (
      id,
      compatibility_email,
      role,
      active,
      membership_version,
      entity_version
    ) values (
      '95000000-0000-4000-8000-000000000001',
      null,
      'manager',
      false,
      1,
      1
    )
  $sql$,
  'Manager is representable in the closed vocabulary without being provisioned'
);

select throws_ok(
  $sql$
    insert into public.ops_employee_auth_identities (
      employee_id,
      auth_user_id,
      state,
      entity_version,
      effective_at
    ) values (
      '95000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000003',
      'active',
      1,
      clock_timestamp()
    )
  $sql$,
  '23505',
  null,
  'one Auth UUID cannot be reused by a second employee even after rotation'
);

select throws_ok(
  $sql$
    insert into public.ops_employee_department_memberships (
      employee_id,
      department_id,
      state,
      membership_version,
      effective_at,
      revoked_at
    ) values (
      '94000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000002',
      'active',
      1,
      now(),
      now()
    )
  $sql$,
  '23514',
  null,
  'an active membership cannot carry a revocation timestamp'
);

select throws_ok(
  $sql$
    update public.ops_employees
    set membership_version = 0
    where id = '94000000-0000-4000-8000-000000000002'
  $sql$,
  '23514',
  null,
  'employee membership versions cannot decrease or become non-positive'
);

select throws_ok(
  $sql$
    update public.ops_identity_audit_events
    set reason = 'rewritten history'
    where employee_id = (
      select employee_id
      from public.ops_employee_auth_identities
      where auth_user_id = '91000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514',
  'ops_identity_audit_events is append-only',
  'identity audit history cannot be updated'
);

select throws_ok(
  $sql$
    delete from public.ops_identity_audit_events
    where employee_id = (
      select employee_id
      from public.ops_employee_auth_identities
      where auth_user_id = '91000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514',
  'ops_identity_audit_events is append-only',
  'identity audit history cannot be deleted'
);

set local role service_role;
select throws_ok(
  $sql$
    insert into public.ops_employees (
      compatibility_email,
      role,
      active,
      membership_version,
      entity_version
    ) values (
      'direct-service-write@example.invalid',
      'office',
      false,
      1,
      1
    )
  $sql$,
  '42501',
  null,
  'service_role cannot bypass the provisioning routine with direct identity DML'
);

select throws_ok(
  $sql$
    insert into public.ops_employee_external_identities (
      employee_id,
      issuer,
      subject_user_id,
      state,
      entity_version,
      effective_at
    ) values (
      '94000000-0000-4000-8000-000000000001',
      'quote_tool',
      '92000000-0000-4000-8000-000000000002',
      'active',
      1,
      clock_timestamp()
    )
  $sql$,
  '42501',
  null,
  'service_role cannot bypass the Quote Tool identity-link routine with direct DML'
);
reset role;

select * from finish();
rollback;
