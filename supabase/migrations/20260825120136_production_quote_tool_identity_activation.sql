-- The request ledger is server-only. It makes an owner action replay-safe,
-- while retaining the exact actor and target for audit/review.
create table public.ops_identity_link_requests (
  actor_employee_id uuid not null references public.ops_employees(id) on delete restrict,
  idempotency_key uuid not null,
  employee_id uuid not null references public.ops_employees(id) on delete restrict,
  quote_tool_auth_user_id uuid not null,
  reason text not null check (nullif(btrim(reason), '') is not null),
  completed_at timestamptz not null,
  primary key (actor_employee_id, idempotency_key)
);

alter table public.ops_identity_link_requests enable row level security;
alter table public.ops_identity_link_requests force row level security;
revoke all on public.ops_identity_link_requests from public, anon, authenticated, service_role;
grant select on public.ops_identity_link_requests to service_role;

create function public.owner_link_quote_tool_employee_identity(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_quote_tool_auth_user_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.ops_employees%rowtype;
  v_target public.ops_employees%rowtype;
  v_existing_request public.ops_identity_link_requests%rowtype;
  v_existing_identity public.ops_employee_external_identities%rowtype;
  v_reason text := btrim(p_reason);
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_actor_employee_id is null or p_employee_id is null or p_quote_tool_auth_user_id is null or p_idempotency_key is null or nullif(v_reason, '') is null then
    raise exception 'actor, employee, Quote Tool identity, idempotency key, and nonblank reason are required' using errcode = '22023';
  end if;
  select * into v_actor from public.ops_employees where id = p_actor_employee_id for update;
  if not found or not v_actor.active or v_actor.deactivated_at is not null or v_actor.role not in ('owner', 'admin') then
    raise exception 'only an active Hub Owner/Admin may link Quote Tool identity' using errcode = '42501';
  end if;
  select * into v_target from public.ops_employees where id = p_employee_id for update;
  if not found or not v_target.active or v_target.deactivated_at is not null then
    raise exception 'Quote Tool identity requires an active Hub employee' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_employee_id::text || ':' || p_idempotency_key::text, 210826)
  );
  select * into v_existing_request
  from public.ops_identity_link_requests
  where actor_employee_id = p_actor_employee_id
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing_request.employee_id = p_employee_id
      and v_existing_request.quote_tool_auth_user_id = p_quote_tool_auth_user_id
      and v_existing_request.reason = v_reason then
      return false;
    end if;
    raise exception 'identity-link idempotency key was already used for a different request' using errcode = '23505';
  end if;

  select * into v_existing_identity
  from public.ops_employee_external_identities
  where issuer = 'quote_tool'
    and subject_user_id = p_quote_tool_auth_user_id
  for update;

  if found and v_existing_identity.employee_id = p_employee_id and v_existing_identity.state = 'active' then
    insert into public.ops_identity_link_requests (
      actor_employee_id, idempotency_key, employee_id, quote_tool_auth_user_id, reason, completed_at
    ) values (
      p_actor_employee_id, p_idempotency_key, p_employee_id, p_quote_tool_auth_user_id, v_reason, v_now
    );
    return false;
  end if;

  perform public.link_quote_tool_employee_identity(p_employee_id, p_quote_tool_auth_user_id, v_reason);
  insert into public.ops_identity_audit_events (employee_id, event_type, entity_version, membership_version, effective_at, reason, detail)
  values (v_target.id, 'auth_identity_linked', v_target.entity_version, v_target.membership_version, v_now, v_reason,
    jsonb_build_object('identity_source', 'quote_tool', 'action', 'owner_link_confirmed', 'actor_employee_id', v_actor.id));
  insert into public.ops_identity_link_requests (
    actor_employee_id, idempotency_key, employee_id, quote_tool_auth_user_id, reason, completed_at
  ) values (
    p_actor_employee_id, p_idempotency_key, p_employee_id, p_quote_tool_auth_user_id, v_reason, v_now
  );
  return true;
end
$function$;

revoke all on function public.owner_link_quote_tool_employee_identity(uuid,uuid,uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.owner_link_quote_tool_employee_identity(uuid,uuid,uuid,text,uuid) to service_role;
