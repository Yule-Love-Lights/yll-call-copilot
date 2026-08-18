-- Hub-owned immutable employee identity and department-membership foundation.
--
-- This migration deliberately does not enable phone OTP, field provisioning,
-- Quote-owned paid-work context, or cross-repository event transport. The
-- canonical shared outbox/inbox/DLQ envelope has not been published yet, so
-- inventing those records here would create a second integration contract.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- Refuse unsafe or ambiguous legacy identity data before any persistent DDL.
do $identity_preflight$
declare
  duplicate_app_user_count bigint;
  missing_auth_app_user_count bigint;
  ambiguous_auth_app_user_count bigint;
  unsupported_role_app_user_count bigint;
  malformed_identity_email_count bigint;
  reserved_objects text[];
begin
  if current_user <> 'postgres' then
    raise exception
      'Application migrations must run as postgres so identity ownership stays deterministic';
  end if;

  if to_regrole('service_role') is null
     or not (select rolbypassrls from pg_roles where rolname = 'service_role') then
    raise exception
      'service_role is absent or lacks BYPASSRLS; refusing identity migration';
  end if;

  if to_regrole('anon') is null or to_regrole('authenticated') is null then
    raise exception 'Required Supabase API roles are absent';
  end if;

  if to_regclass('public.app_users') is null
     or to_regclass('public.leads') is null
     or to_regclass('public.calls') is null
     or to_regclass('auth.users') is null then
    raise exception
      'Required legacy identity, lead-work, or Supabase Auth relations are absent';
  end if;

  select array_agg(object_name order by object_name)
  into reserved_objects
  from unnest(array[
    'public.ops_departments',
    'public.ops_employees',
    'public.ops_employee_auth_identities',
    'public.ops_employee_department_memberships',
    'public.ops_identity_audit_events'
  ]) as reserved(object_name)
  where to_regclass(reserved.object_name) is not null;

  if coalesce(cardinality(reserved_objects), 0) > 0 then
    raise exception 'Reserved Hub identity relations already exist: %', reserved_objects;
  end if;

  if to_regprocedure(
       'public.provision_legacy_office_employee(uuid,text,text)'
     ) is not null then
    raise exception 'Reserved Hub identity provisioning routine already exists';
  end if;

  select count(*)
  into malformed_identity_email_count
  from public.app_users as legacy_user
  where nullif(btrim(legacy_user.email), '') is null
     or lower(btrim(legacy_user.email)) not like '%@%'
     or exists (
       select 1
       from auth.users as auth_user
       where lower(btrim(auth_user.email)) = lower(btrim(legacy_user.email))
         and (
           nullif(btrim(auth_user.email), '') is null
           or lower(btrim(auth_user.email)) not like '%@%'
         )
     );

  if malformed_identity_email_count > 0 then
    raise exception
      'Malformed normalized identity emails require review before migration 0023 (affected_app_users=%)',
      malformed_identity_email_count;
  end if;

  -- Failure output is aggregate-only. An operator may run the corresponding
  -- SELECT inside the protected database to identify rows; migration and CI
  -- logs never print employee/auth UUIDs or email addresses.
  select count(*)
  into unsupported_role_app_user_count
  from public.app_users as legacy_user
  where lower(btrim(legacy_user.role)) not in ('rep', 'office', 'owner', 'admin');

  if unsupported_role_app_user_count > 0 then
    raise exception
      'Unsupported legacy app_users roles require review before migration 0023 (affected_app_users=%)',
      unsupported_role_app_user_count;
  end if;

  select coalesce(sum(duplicate_group.group_count), 0)::bigint
  into duplicate_app_user_count
  from (
    select count(*)::bigint as group_count
    from public.app_users as legacy_user
    group by lower(btrim(legacy_user.email))
    having count(*) > 1
  ) as duplicate_group;

  if duplicate_app_user_count > 0 then
    raise exception
      'Duplicate normalized app_users emails require review before migration 0023 (affected_app_users=%)',
      duplicate_app_user_count;
  end if;

  select count(*)
  into missing_auth_app_user_count
  from public.app_users as legacy_user
  where not exists (
    select 1
    from auth.users as auth_user
    where lower(btrim(auth_user.email)) = lower(btrim(legacy_user.email))
  );

  if missing_auth_app_user_count > 0 then
    raise exception
      'Missing normalized auth.users mapping before migration 0023 (affected_app_users=%)',
      missing_auth_app_user_count;
  end if;

  select count(*)
  into ambiguous_auth_app_user_count
  from public.app_users as legacy_user
  where (
    select count(*)
    from auth.users as auth_user
    where lower(btrim(auth_user.email)) = lower(btrim(legacy_user.email))
  ) > 1;

  if ambiguous_auth_app_user_count > 0 then
    raise exception
      'Ambiguous normalized auth.users mapping before migration 0023 (affected_app_users=%)',
      ambiguous_auth_app_user_count;
  end if;

  if not exists (
    select 1
    from pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.leads'::regclass
      and constraint_record.confrelid = 'public.app_users'::regclass
      and constraint_record.conname = 'leads_claimed_employee_id_fkey'
      and constraint_record.contype = 'f'
      and constraint_record.confdeltype = 'r'
      and constraint_record.convalidated
      and constraint_record.conkey = array[
        (
          select attribute.attnum
          from pg_attribute as attribute
          where attribute.attrelid = 'public.leads'::regclass
            and attribute.attname = 'claimed_employee_id'
            and not attribute.attisdropped
        )
      ]::smallint[]
      and constraint_record.confkey = array[
        (
          select attribute.attnum
          from pg_attribute as attribute
          where attribute.attrelid = 'public.app_users'::regclass
            and attribute.attname = 'id'
            and not attribute.attisdropped
        )
      ]::smallint[]
  ) then
    raise exception
      'Expected validated leads.claimed_employee_id -> app_users.id RESTRICT foreign key is absent';
  end if;

  if not exists (
    select 1
    from pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.calls'::regclass
      and constraint_record.confrelid = 'public.app_users'::regclass
      and constraint_record.conname = 'calls_rep_employee_id_fkey'
      and constraint_record.contype = 'f'
      and constraint_record.confdeltype = 'r'
      and constraint_record.convalidated
      and constraint_record.conkey = array[
        (
          select attribute.attnum
          from pg_attribute as attribute
          where attribute.attrelid = 'public.calls'::regclass
            and attribute.attname = 'rep_employee_id'
            and not attribute.attisdropped
        )
      ]::smallint[]
      and constraint_record.confkey = array[
        (
          select attribute.attnum
          from pg_attribute as attribute
          where attribute.attrelid = 'public.app_users'::regclass
            and attribute.attname = 'id'
            and not attribute.attisdropped
        )
      ]::smallint[]
  ) then
    raise exception
      'Expected validated calls.rep_employee_id -> app_users.id RESTRICT foreign key is absent';
  end if;
end
$identity_preflight$;

create table public.ops_departments (
  id uuid primary key,
  slug text not null unique,
  display_name text not null,
  active boolean not null default true,
  entity_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_departments_slug_check
    check (slug = lower(btrim(slug)) and slug in ('office', 'advertising', 'installer')),
  constraint ops_departments_display_name_check
    check (nullif(btrim(display_name), '') is not null),
  constraint ops_departments_entity_version_check
    check (entity_version >= 1)
);

create table public.ops_employees (
  id uuid primary key default gen_random_uuid(),
  compatibility_email text unique,
  display_name text,
  verified_phone_e164 text unique,
  telegram_user_id bigint unique,
  language text not null default 'en',
  role text not null,
  active boolean not null default false,
  membership_version bigint not null default 1,
  entity_version bigint not null default 1,
  effective_at timestamptz not null default now(),
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_employees_compatibility_email_check
    check (
      compatibility_email is null
      or (
        compatibility_email = lower(btrim(compatibility_email))
        and compatibility_email like '%@%'
      )
    ),
  constraint ops_employees_display_name_check
    check (display_name is null or nullif(btrim(display_name), '') is not null),
  constraint ops_employees_verified_phone_e164_check
    check (
      verified_phone_e164 is null
      or verified_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
    ),
  constraint ops_employees_language_check
    check (language = btrim(language) and language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  constraint ops_employees_role_check
    check (role in ('office', 'advertising', 'installer', 'owner', 'admin', 'manager')),
  constraint ops_employees_membership_version_check
    check (membership_version >= 1),
  constraint ops_employees_entity_version_check
    check (entity_version >= 1),
  constraint ops_employees_active_state_check
    check (not active or deactivated_at is null),
  constraint ops_employees_legacy_compatibility_check
    check (
      not active
      or role not in ('office', 'owner', 'admin')
      or compatibility_email is not null
    ),
  constraint ops_employees_deactivated_at_check
    check (deactivated_at is null or deactivated_at >= effective_at)
);

create table public.ops_employee_auth_identities (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null
    references public.ops_employees(id) on delete restrict,
  auth_user_id uuid not null unique
    references auth.users(id) on delete restrict,
  state text not null,
  entity_version bigint not null,
  effective_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_employee_auth_identities_state_check
    check (state in ('active', 'revoked')),
  constraint ops_employee_auth_identities_entity_version_check
    check (entity_version >= 1),
  constraint ops_employee_auth_identities_state_time_check
    check (
      (state = 'active' and revoked_at is null)
      or
      (state = 'revoked' and revoked_at is not null and revoked_at >= effective_at)
    ),
  constraint ops_employee_auth_identities_version_key
    unique (employee_id, entity_version)
);

create unique index ops_employee_auth_identities_one_active_idx
  on public.ops_employee_auth_identities (employee_id)
  where state = 'active';

create index ops_employee_auth_identities_employee_history_idx
  on public.ops_employee_auth_identities (employee_id, effective_at, id);

create table public.ops_employee_department_memberships (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null
    references public.ops_employees(id) on delete restrict,
  department_id uuid not null
    references public.ops_departments(id) on delete restrict,
  state text not null,
  membership_version bigint not null,
  effective_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_employee_department_memberships_state_check
    check (state in ('active', 'revoked')),
  constraint ops_employee_department_memberships_version_check
    check (membership_version >= 1),
  constraint ops_employee_department_memberships_state_time_check
    check (
      (state = 'active' and revoked_at is null)
      or
      (state = 'revoked' and revoked_at is not null and revoked_at >= effective_at)
    ),
  constraint ops_employee_department_memberships_revision_key
    unique (employee_id, department_id, membership_version)
);

create unique index ops_employee_department_memberships_one_active_idx
  on public.ops_employee_department_memberships (employee_id, department_id)
  where state = 'active';

create index ops_employee_department_memberships_employee_idx
  on public.ops_employee_department_memberships (employee_id, membership_version);

create table public.ops_identity_audit_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null
    references public.ops_employees(id) on delete restrict,
  actor_employee_id uuid
    references public.ops_employees(id) on delete restrict,
  event_type text not null,
  entity_version bigint,
  membership_version bigint,
  effective_at timestamptz not null,
  reason text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ops_identity_audit_events_type_check
    check (
      event_type in (
        'legacy_identity_backfilled',
        'legacy_office_provisioned',
        'auth_identity_linked',
        'auth_identity_revoked',
        'employee_activated',
        'employee_deactivated',
        'role_changed',
        'membership_granted',
        'membership_revoked'
      )
    ),
  constraint ops_identity_audit_events_entity_version_check
    check (entity_version is null or entity_version >= 1),
  constraint ops_identity_audit_events_membership_version_check
    check (membership_version is null or membership_version >= 1),
  constraint ops_identity_audit_events_reason_check
    check (nullif(btrim(reason), '') is not null),
  constraint ops_identity_audit_events_detail_check
    check (jsonb_typeof(detail) = 'object')
);

create index ops_identity_audit_events_employee_idx
  on public.ops_identity_audit_events (employee_id, created_at, id);

-- These UUIDs are stable cross-deployment identifiers. Management is not a
-- department; it remains an owner/admin view and digest type.
insert into public.ops_departments (
  id,
  slug,
  display_name,
  active,
  entity_version
) values
  ('00000000-0000-4000-8000-000000000001', 'office', 'Office', true, 1),
  ('00000000-0000-4000-8000-000000000002', 'advertising', 'Advertising', true, 1),
  ('00000000-0000-4000-8000-000000000003', 'installer', 'Installer', true, 1);

-- Preserve every legacy employee UUID exactly while replacing normalized
-- email matching with the first row in versioned Supabase Auth UUID history.
insert into public.ops_employees (
  id,
  compatibility_email,
  role,
  active,
  membership_version,
  entity_version,
  effective_at,
  created_at,
  updated_at
)
select
  legacy_user.id,
  lower(btrim(legacy_user.email)),
  case lower(btrim(legacy_user.role))
    when 'rep' then 'office'
    else lower(btrim(legacy_user.role))
  end,
  true,
  1,
  1,
  coalesce(legacy_user.created_at, now()),
  coalesce(legacy_user.created_at, now()),
  now()
from public.app_users as legacy_user
join auth.users as auth_user
  on lower(btrim(auth_user.email)) = lower(btrim(legacy_user.email));

insert into public.ops_employee_auth_identities (
  employee_id,
  auth_user_id,
  state,
  entity_version,
  effective_at,
  created_at,
  updated_at
)
select
  employee.id,
  auth_user.id,
  'active',
  1,
  employee.effective_at,
  employee.created_at,
  now()
from public.ops_employees as employee
join auth.users as auth_user
  on lower(btrim(auth_user.email)) = employee.compatibility_email;

-- Office employees receive only Office. Owner/Admin receives all three V1
-- employee departments. No Advertising, Installer, or Manager identity is
-- provisioned by this migration.
insert into public.ops_employee_department_memberships (
  employee_id,
  department_id,
  state,
  membership_version,
  effective_at
)
select
  employee.id,
  department.id,
  'active',
  employee.membership_version,
  employee.effective_at
from public.ops_employees as employee
join public.ops_departments as department
  on (
    employee.role = 'office' and department.slug = 'office'
  ) or (
    employee.role in ('owner', 'admin')
    and department.slug in ('office', 'advertising', 'installer')
  );

insert into public.ops_identity_audit_events (
  employee_id,
  event_type,
  entity_version,
  membership_version,
  effective_at,
  reason,
  detail
)
select
  employee.id,
  'legacy_identity_backfilled',
  employee.entity_version,
  employee.membership_version,
  employee.effective_at,
  'migration_0023_identity_foundation',
  jsonb_build_object('source', 'app_users')
from public.ops_employees as employee;

-- Normalize the legacy table once, then protect it as a derived compatibility
-- projection. Existing 0020 routines can continue locking this row while the
-- authoritative employee record lives in ops_employees.
update public.app_users as legacy_user
set
  email = employee.compatibility_email,
  role = employee.role,
  created_at = employee.created_at
from public.ops_employees as employee
where employee.id = legacy_user.id;

alter table public.leads
  drop constraint leads_claimed_employee_id_fkey;
alter table public.leads
  add constraint leads_claimed_employee_id_fkey
  foreign key (claimed_employee_id)
  references public.ops_employees(id)
  on delete restrict
  not valid;

alter table public.calls
  drop constraint calls_rep_employee_id_fkey;
alter table public.calls
  add constraint calls_rep_employee_id_fkey
  foreign key (rep_employee_id)
  references public.ops_employees(id)
  on delete restrict
  not valid;

alter table public.leads validate constraint leads_claimed_employee_id_fkey;
alter table public.calls validate constraint calls_rep_employee_id_fkey;

create function public.enforce_ops_employee_identity_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'ops_employees rows are immutable identities; deactivate instead'
      using errcode = '23514';
  end if;

  if new.id is distinct from old.id then
    raise exception 'ops_employees.id is immutable'
      using errcode = '23514';
  end if;

  if new.compatibility_email is distinct from old.compatibility_email then
    raise exception 'ops_employees.compatibility_email is immutable'
      using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(old.id::text, 210022)
  );

  if new.membership_version < old.membership_version then
    raise exception 'ops_employees.membership_version cannot decrease'
      using errcode = '23514';
  end if;

  if new.entity_version < old.entity_version then
    raise exception 'ops_employees.entity_version cannot decrease'
      using errcode = '23514';
  end if;

  return new;
end
$function$;

create trigger enforce_ops_employee_identity_immutability
before update or delete on public.ops_employees
for each row execute function public.enforce_ops_employee_identity_immutability();

create function public.enforce_ops_employee_auth_identity_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_expected_version bigint;
begin
  if tg_op = 'DELETE' then
    raise exception 'ops_employee_auth_identities is immutable history'
      using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.employee_id::text, 210022)
  );

  if tg_op = 'INSERT' then
    if new.state <> 'active' or new.revoked_at is not null then
      raise exception 'a new employee Auth identity must start active'
        using errcode = '23514';
    end if;

    if new.effective_at > pg_catalog.clock_timestamp() then
      raise exception 'an active employee Auth identity cannot be future-effective'
        using errcode = '23514';
    end if;

    select coalesce(max(auth_identity.entity_version), 0) + 1
    into v_expected_version
    from public.ops_employee_auth_identities as auth_identity
    where auth_identity.employee_id = new.employee_id;

    if new.entity_version <> v_expected_version then
      raise exception 'employee Auth identity version is not the next monotonic value'
        using errcode = '23514';
    end if;

    if exists (
      select 1
      from public.ops_employee_auth_identities as auth_identity
      where auth_identity.employee_id = new.employee_id
        and auth_identity.state = 'active'
    ) then
      raise exception 'employee already has an active Auth identity'
        using errcode = '23514';
    end if;

    if exists (
      select 1
      from public.ops_employee_auth_identities as auth_identity
      where auth_identity.employee_id = new.employee_id
        and (
          auth_identity.effective_at > new.effective_at
          or auth_identity.revoked_at > new.effective_at
        )
    ) then
      raise exception 'employee Auth identity effective time cannot move backward'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if new.id is distinct from old.id
     or new.employee_id is distinct from old.employee_id
     or new.auth_user_id is distinct from old.auth_user_id
     or new.effective_at is distinct from old.effective_at
     or new.created_at is distinct from old.created_at then
    raise exception 'employee/Auth UUID linkage and effective time are immutable'
      using errcode = '23514';
  end if;

  if old.state = 'revoked' then
    raise exception 'a revoked employee Auth identity is terminal'
      using errcode = '23514';
  end if;

  if new.state <> 'revoked'
     or new.revoked_at is null
     or new.revoked_at > pg_catalog.clock_timestamp()
     or new.entity_version <> old.entity_version + 1
     or new.updated_at < old.updated_at then
    raise exception 'Auth identity transition must be active to terminal revoked at the next version'
      using errcode = '23514';
  end if;

  return new;
end
$function$;

create trigger enforce_ops_employee_auth_identity_transition
before insert or update or delete on public.ops_employee_auth_identities
for each row execute function public.enforce_ops_employee_auth_identity_transition();

create function public.guard_app_users_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    if exists (
      select 1
      from public.ops_employees as employee
      join public.ops_employee_auth_identities as auth_identity
        on auth_identity.employee_id = employee.id
       and auth_identity.state = 'active'
      where employee.id = old.id
        and employee.active
        and employee.compatibility_email is not null
        and employee.role in ('office', 'owner', 'admin')
    ) then
      raise exception 'app_users is a protected active-employee projection'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    raise exception 'app_users.id is immutable'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.ops_employees as employee
    join public.ops_employee_auth_identities as auth_identity
      on auth_identity.employee_id = employee.id
     and auth_identity.state = 'active'
    where employee.id = new.id
      and employee.active
      and employee.compatibility_email is not null
      and employee.role in ('office', 'owner', 'admin')
      and employee.compatibility_email = new.email
      and employee.role = new.role
      and employee.created_at = new.created_at
  ) then
    raise exception 'app_users write does not match its authoritative ops_employee'
      using errcode = '23514';
  end if;

  return new;
end
$function$;

create trigger guard_app_users_projection
before insert or update or delete on public.app_users
for each row execute function public.guard_app_users_projection();

create function public.sync_app_user_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_employee_id uuid;
  v_employee public.ops_employees%rowtype;
begin
  if tg_table_name = 'ops_employees' then
    v_employee_id := new.id;
  else
    v_employee_id := new.employee_id;
  end if;

  select employee.*
  into v_employee
  from public.ops_employees as employee
  where employee.id = v_employee_id;

  if found
     and v_employee.active
     and v_employee.compatibility_email is not null
     and v_employee.role in ('office', 'owner', 'admin')
     and exists (
       select 1
       from public.ops_employee_auth_identities as auth_identity
       where auth_identity.employee_id = v_employee.id
         and auth_identity.state = 'active'
     ) then
    insert into public.app_users (id, email, role, created_at)
    values (
      v_employee.id,
      v_employee.compatibility_email,
      v_employee.role,
      v_employee.created_at
    )
    on conflict (id) do update
      set email = excluded.email,
          role = excluded.role,
          created_at = excluded.created_at;
  else
    delete from public.app_users
    where id = v_employee_id;
  end if;

  return new;
end
$function$;

create trigger sync_app_user_projection
after insert or update of compatibility_email, role, active, created_at
on public.ops_employees
for each row execute function public.sync_app_user_projection();

create trigger sync_app_user_projection
after insert or update of state on public.ops_employee_auth_identities
for each row execute function public.sync_app_user_projection();

create function public.reject_ops_identity_audit_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'ops_identity_audit_events is append-only'
    using errcode = '23514';
end
$function$;

create trigger reject_ops_identity_audit_event_mutation
before update or delete on public.ops_identity_audit_events
for each row execute function public.reject_ops_identity_audit_event_mutation();

create function public.provision_legacy_office_employee(
  p_auth_user_id uuid,
  p_compatibility_email text,
  p_reason text
)
returns table (
  employee_id uuid,
  auth_user_id uuid,
  compatibility_email text,
  role text,
  active boolean,
  membership_version bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email text := lower(btrim(p_compatibility_email));
  v_reason text := btrim(p_reason);
  v_auth_email text;
  v_auth_identity public.ops_employee_auth_identities%rowtype;
  v_by_email public.ops_employees%rowtype;
  v_employee public.ops_employees%rowtype;
  v_office_department_id uuid := '00000000-0000-4000-8000-000000000001';
  v_now timestamptz := clock_timestamp();
begin
  if p_auth_user_id is null
     or nullif(v_email, '') is null
     or v_email not like '%@%'
     or nullif(v_reason, '') is null then
    raise exception 'auth UUID, normalized email, and nonblank reason are required'
      using errcode = '22023';
  end if;

  -- Serializes exact retries for one Auth identity and proves the supplied
  -- compatibility email belongs to that immutable UUID.
  select lower(btrim(auth_user.email))
  into v_auth_email
  from auth.users as auth_user
  where auth_user.id = p_auth_user_id
  for update;

  if not found or v_auth_email is distinct from v_email then
    raise exception 'Supabase Auth UUID and compatibility email do not match'
      using errcode = '23514';
  end if;

  -- Different Auth UUIDs can still present raw emails that normalize to the
  -- same value. Serialize that key before checking/inserting so a conflict
  -- returns the safe domain error below instead of a unique-index detail that
  -- could echo an email address into logs.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_email, 210021)
  );

  select auth_identity.*
  into v_auth_identity
  from public.ops_employee_auth_identities as auth_identity
  where auth_identity.auth_user_id = p_auth_user_id
  for update;

  select employee.*
  into v_by_email
  from public.ops_employees as employee
  where employee.compatibility_email = v_email
  for update;

  if v_auth_identity.id is not null then
    select employee.*
    into v_employee
    from public.ops_employees as employee
    where employee.id = v_auth_identity.employee_id
    for update;
  end if;

  if v_auth_identity.id is not null
     and v_by_email.id is not null
     and v_auth_identity.employee_id <> v_by_email.id then
    raise exception 'Auth UUID and compatibility email belong to different employees'
      using errcode = '23505';
  end if;

  if v_auth_identity.id is not null then
    if v_auth_identity.state <> 'active' then
      raise exception 'Existing employee Auth identity is revoked'
        using errcode = '23514';
    end if;

    if v_employee.compatibility_email is distinct from v_email then
      raise exception 'Existing employee identity conflicts with requested Auth link'
        using errcode = '23505';
    end if;
  elsif v_by_email.id is not null then
    if exists (
      select 1
      from public.ops_employee_auth_identities as auth_identity
      where auth_identity.employee_id = v_by_email.id
    ) then
      raise exception 'Existing employee identity conflicts with requested Auth link'
        using errcode = '23505';
    end if;

    v_employee := v_by_email;
  end if;

  if v_employee.id is not null then
    if v_employee.compatibility_email is distinct from v_email then
      raise exception 'Existing employee identity conflicts with requested Auth link'
        using errcode = '23505';
    end if;

    if v_employee.role <> 'office'
       or not v_employee.active
       or v_employee.effective_at > v_now
       or not exists (
         select 1
         from public.ops_employee_department_memberships as membership
         join public.ops_departments as department
           on department.id = membership.department_id
          and department.active
         where membership.employee_id = v_employee.id
           and membership.department_id = v_office_department_id
           and membership.state = 'active'
           and membership.revoked_at is null
           and membership.effective_at <= v_now
           and membership.membership_version <= v_employee.membership_version
       ) then
      raise exception 'Existing employee is not an active Office identity'
        using errcode = '23514';
    end if;

    if v_auth_identity.id is null then
      insert into public.ops_employee_auth_identities (
        employee_id,
        auth_user_id,
        state,
        entity_version,
        effective_at,
        created_at,
        updated_at
      ) values (
        v_employee.id,
        p_auth_user_id,
        'active',
        1,
        v_now,
        v_now,
        v_now
      );

      insert into public.ops_identity_audit_events (
        employee_id,
        event_type,
        entity_version,
        membership_version,
        effective_at,
        reason,
        detail
      ) values (
        v_employee.id,
        'auth_identity_linked',
        v_employee.entity_version,
        v_employee.membership_version,
        v_now,
        v_reason,
        jsonb_build_object('source', 'legacy_office_provisioning_routine')
      );
    end if;

    return query
    select
      v_employee.id,
      p_auth_user_id,
      v_employee.compatibility_email,
      v_employee.role,
      v_employee.active,
      v_employee.membership_version;
    return;
  end if;

  insert into public.ops_employees (
    compatibility_email,
    role,
    active,
    membership_version,
    entity_version,
    effective_at,
    created_at,
    updated_at
  ) values (
    v_email,
    'office',
    true,
    1,
    1,
    v_now,
    v_now,
    v_now
  )
  returning * into v_employee;

  insert into public.ops_employee_department_memberships (
    employee_id,
    department_id,
    state,
    membership_version,
    effective_at,
    created_at,
    updated_at
  ) values (
    v_employee.id,
    v_office_department_id,
    'active',
    1,
    v_now,
    v_now,
    v_now
  );

  insert into public.ops_employee_auth_identities (
    employee_id,
    auth_user_id,
    state,
    entity_version,
    effective_at,
    created_at,
    updated_at
  ) values (
    v_employee.id,
    p_auth_user_id,
    'active',
    1,
    v_now,
    v_now,
    v_now
  );

  insert into public.ops_identity_audit_events (
    employee_id,
    event_type,
    entity_version,
    membership_version,
    effective_at,
    reason,
    detail
  ) values (
    v_employee.id,
    'legacy_office_provisioned',
    v_employee.entity_version,
    v_employee.membership_version,
    v_now,
    v_reason,
    jsonb_build_object('source', 'legacy_office_provisioning_routine')
  );

  return query
  select
    v_employee.id,
    p_auth_user_id,
    v_employee.compatibility_email,
    v_employee.role,
    v_employee.active,
    v_employee.membership_version;
end
$function$;

-- New identity tables stay API-inaccessible. Server handlers can read the
-- authoritative snapshots; all writes go through reviewed SECURITY DEFINER
-- routines. Browser roles retain no schema or object access.
alter table public.ops_departments enable row level security;
alter table public.ops_departments force row level security;
alter table public.ops_employees enable row level security;
alter table public.ops_employees force row level security;
alter table public.ops_employee_auth_identities enable row level security;
alter table public.ops_employee_auth_identities force row level security;
alter table public.ops_employee_department_memberships enable row level security;
alter table public.ops_employee_department_memberships force row level security;
alter table public.ops_identity_audit_events enable row level security;
alter table public.ops_identity_audit_events force row level security;

revoke all privileges on table
  public.ops_departments,
  public.ops_employees,
  public.ops_employee_auth_identities,
  public.ops_employee_department_memberships,
  public.ops_identity_audit_events
from public, anon, authenticated, service_role;

grant select on table
  public.ops_departments,
  public.ops_employees,
  public.ops_employee_auth_identities,
  public.ops_employee_department_memberships,
  public.ops_identity_audit_events
to service_role;

-- Existing 0020 SECURITY INVOKER routines lock app_users with SELECT FOR
-- UPDATE. PostgreSQL requires UPDATE on at least one column for that lock, so
-- retain only UPDATE(id); the guard keeps the projection key immutable while
-- all compatibility data and row creation/deletion remain trigger-owned.
revoke all privileges on table public.app_users from service_role;
revoke all privileges (id, email, role, created_at)
on table public.app_users
from service_role;
grant select on table public.app_users to service_role;
grant update (id) on table public.app_users to service_role;

revoke all privileges on function
  public.enforce_ops_employee_identity_immutability(),
  public.enforce_ops_employee_auth_identity_transition(),
  public.guard_app_users_projection(),
  public.sync_app_user_projection(),
  public.reject_ops_identity_audit_event_mutation(),
  public.provision_legacy_office_employee(uuid, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.provision_legacy_office_employee(uuid, text, text)
to service_role;

reset lock_timeout;
reset statement_timeout;
