-- Shared staff credentials, separate applications: the Quote Tool remains the
-- credential authority while this Hub keeps its own employee and capability
-- decisions. A Quote Tool Auth UUID grants nothing until it is explicitly
-- linked to an active Hub employee through the service-role routine below.

create table public.ops_employee_external_identities (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null
    references public.ops_employees(id) on delete restrict,
  issuer text not null,
  subject_user_id uuid not null,
  state text not null,
  entity_version bigint not null,
  effective_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_employee_external_identities_issuer_check
    check (issuer = 'quote_tool'),
  constraint ops_employee_external_identities_state_check
    check (state in ('active', 'revoked')),
  constraint ops_employee_external_identities_entity_version_check
    check (entity_version >= 1),
  constraint ops_employee_external_identities_state_time_check
    check (
      (state = 'active' and revoked_at is null)
      or
      (state = 'revoked' and revoked_at is not null and revoked_at >= effective_at)
    ),
  constraint ops_employee_external_identities_subject_key
    unique (issuer, subject_user_id),
  constraint ops_employee_external_identities_version_key
    unique (employee_id, issuer, entity_version)
);

create unique index ops_employee_external_identities_one_active_idx
  on public.ops_employee_external_identities (employee_id, issuer)
  where state = 'active';

create index ops_employee_external_identities_employee_history_idx
  on public.ops_employee_external_identities (employee_id, issuer, effective_at, id);

create function public.enforce_ops_employee_external_identity_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_expected_version bigint;
begin
  if tg_op = 'DELETE' then
    raise exception 'ops_employee_external_identities is immutable history'
      using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.employee_id::text, 210025)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.issuer || ':' || new.subject_user_id::text, 210025)
  );

  if tg_op = 'INSERT' then
    if new.state <> 'active' or new.revoked_at is not null then
      raise exception 'a new external employee identity must start active'
        using errcode = '23514';
    end if;
    if new.effective_at > pg_catalog.clock_timestamp() then
      raise exception 'an active external employee identity cannot be future-effective'
        using errcode = '23514';
    end if;

    select coalesce(max(identity_record.entity_version), 0) + 1
    into v_expected_version
    from public.ops_employee_external_identities as identity_record
    where identity_record.employee_id = new.employee_id
      and identity_record.issuer = new.issuer;

    if new.entity_version <> v_expected_version then
      raise exception 'external employee identity version is not the next monotonic value'
        using errcode = '23514';
    end if;

    if exists (
      select 1
      from public.ops_employee_external_identities as identity_record
      where identity_record.employee_id = new.employee_id
        and identity_record.issuer = new.issuer
        and identity_record.state = 'active'
    ) then
      raise exception 'employee already has an active identity for this issuer'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if new.id is distinct from old.id
     or new.employee_id is distinct from old.employee_id
     or new.issuer is distinct from old.issuer
     or new.subject_user_id is distinct from old.subject_user_id
     or new.effective_at is distinct from old.effective_at
     or new.created_at is distinct from old.created_at then
    raise exception 'external identity linkage and effective time are immutable'
      using errcode = '23514';
  end if;

  if old.state = 'revoked' then
    raise exception 'a revoked external employee identity is terminal'
      using errcode = '23514';
  end if;

  if new.state <> 'revoked'
     or new.revoked_at is null
     or new.revoked_at > pg_catalog.clock_timestamp()
     or new.entity_version <> old.entity_version + 1
     or new.updated_at < old.updated_at then
    raise exception 'external identity transition must be active to terminal revoked at the next version'
      using errcode = '23514';
  end if;

  return new;
end
$function$;

create trigger enforce_ops_employee_external_identity_transition
before insert or update or delete on public.ops_employee_external_identities
for each row execute function public.enforce_ops_employee_external_identity_transition();

create function public.link_quote_tool_employee_identity(
  p_employee_id uuid,
  p_quote_tool_auth_user_id uuid,
  p_reason text
)
returns table (
  employee_id uuid,
  quote_tool_auth_user_id uuid,
  role text,
  active boolean,
  membership_version bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reason text := btrim(p_reason);
  v_employee public.ops_employees%rowtype;
  v_existing public.ops_employee_external_identities%rowtype;
  v_next_version bigint;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_employee_id is null
     or p_quote_tool_auth_user_id is null
     or nullif(v_reason, '') is null then
    raise exception 'employee UUID, Quote Tool Auth UUID, and nonblank reason are required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_employee_id::text, 210025)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('quote_tool:' || p_quote_tool_auth_user_id::text, 210025)
  );

  select employee.*
  into v_employee
  from public.ops_employees as employee
  where employee.id = p_employee_id
  for update;

  if not found
     or not v_employee.active
     or v_employee.effective_at > v_now
     or v_employee.deactivated_at is not null
     or v_employee.compatibility_email is null
     or v_employee.role not in ('office', 'owner', 'admin') then
    raise exception 'Quote Tool identity requires an active Hub Office or Owner/Admin employee'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.ops_employee_department_memberships as membership
    join public.ops_departments as department
      on department.id = membership.department_id
    where membership.employee_id = v_employee.id
      and membership.state = 'active'
      and membership.effective_at <= v_now
      and membership.revoked_at is null
      and membership.membership_version <= v_employee.membership_version
      and department.active
      and (
        v_employee.role in ('owner', 'admin')
        or department.slug = 'office'
      )
  ) then
    raise exception 'Quote Tool identity requires a current Hub membership'
      using errcode = '23514';
  end if;

  select identity_record.*
  into v_existing
  from public.ops_employee_external_identities as identity_record
  where identity_record.issuer = 'quote_tool'
    and identity_record.subject_user_id = p_quote_tool_auth_user_id
  for update;

  if found then
    if v_existing.employee_id <> v_employee.id then
      raise exception 'Quote Tool Auth UUID is already linked to another employee'
        using errcode = '23505';
    end if;
    if v_existing.state <> 'active' then
      raise exception 'Quote Tool employee identity is revoked'
        using errcode = '23514';
    end if;
    return query
    select
      v_employee.id,
      p_quote_tool_auth_user_id,
      v_employee.role,
      v_employee.active,
      v_employee.membership_version;
    return;
  end if;

  if exists (
    select 1
    from public.ops_employee_external_identities as identity_record
    where identity_record.employee_id = v_employee.id
      and identity_record.issuer = 'quote_tool'
      and identity_record.state = 'active'
  ) then
    raise exception 'Hub employee already has an active Quote Tool identity'
      using errcode = '23505';
  end if;

  select coalesce(max(identity_record.entity_version), 0) + 1
  into v_next_version
  from public.ops_employee_external_identities as identity_record
  where identity_record.employee_id = v_employee.id
    and identity_record.issuer = 'quote_tool';

  insert into public.ops_employee_external_identities (
    employee_id,
    issuer,
    subject_user_id,
    state,
    entity_version,
    effective_at,
    created_at,
    updated_at
  ) values (
    v_employee.id,
    'quote_tool',
    p_quote_tool_auth_user_id,
    'active',
    v_next_version,
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
    jsonb_build_object(
      'identity_source', 'quote_tool',
      'subject_kind', 'external_auth_user'
    )
  );

  return query
  select
    v_employee.id,
    p_quote_tool_auth_user_id,
    v_employee.role,
    v_employee.active,
    v_employee.membership_version;
end
$function$;

create function public.revoke_quote_tool_employee_identity(
  p_employee_id uuid,
  p_quote_tool_auth_user_id uuid,
  p_reason text
)
returns table (
  employee_id uuid,
  quote_tool_auth_user_id uuid,
  state text,
  entity_version bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reason text := btrim(p_reason);
  v_employee public.ops_employees%rowtype;
  v_identity public.ops_employee_external_identities%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_employee_id is null
     or p_quote_tool_auth_user_id is null
     or nullif(v_reason, '') is null then
    raise exception 'employee UUID, Quote Tool Auth UUID, and nonblank reason are required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_employee_id::text, 210025)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('quote_tool:' || p_quote_tool_auth_user_id::text, 210025)
  );

  select employee.*
  into v_employee
  from public.ops_employees as employee
  where employee.id = p_employee_id
  for update;

  if not found then
    raise exception 'Hub employee was not found'
      using errcode = '23514';
  end if;

  select identity_record.*
  into v_identity
  from public.ops_employee_external_identities as identity_record
  where identity_record.employee_id = p_employee_id
    and identity_record.issuer = 'quote_tool'
    and identity_record.subject_user_id = p_quote_tool_auth_user_id
  for update;

  if not found then
    raise exception 'Quote Tool employee identity was not found'
      using errcode = '23514';
  end if;

  if v_identity.state = 'revoked' then
    return query
    select
      v_employee.id,
      p_quote_tool_auth_user_id,
      v_identity.state,
      v_identity.entity_version;
    return;
  end if;

  update public.ops_employee_external_identities
  set
    state = 'revoked',
    entity_version = v_identity.entity_version + 1,
    revoked_at = v_now,
    updated_at = v_now
  where id = v_identity.id;

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
    'auth_identity_revoked',
    v_employee.entity_version,
    v_employee.membership_version,
    v_now,
    v_reason,
    jsonb_build_object(
      'identity_source', 'quote_tool',
      'subject_kind', 'external_auth_user'
    )
  );

  return query
  select
    v_employee.id,
    p_quote_tool_auth_user_id,
    'revoked'::text,
    v_identity.entity_version + 1;
end
$function$;

alter table public.ops_employee_external_identities enable row level security;
alter table public.ops_employee_external_identities force row level security;

revoke all privileges on table public.ops_employee_external_identities
from public, anon, authenticated, service_role;
grant select on table public.ops_employee_external_identities to service_role;

revoke all privileges on function
  public.enforce_ops_employee_external_identity_transition(),
  public.link_quote_tool_employee_identity(uuid,uuid,text),
  public.revoke_quote_tool_employee_identity(uuid,uuid,text)
from public, anon, authenticated, service_role;
grant execute on function public.link_quote_tool_employee_identity(uuid,uuid,text)
to service_role;
grant execute on function public.revoke_quote_tool_employee_identity(uuid,uuid,text)
to service_role;
