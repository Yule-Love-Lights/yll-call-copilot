-- Hub-owned Office tasks. These records deliberately do not replace the
-- Quote Tool lifecycle ledger or mutate call_commitments source evidence.
-- The public Data API remains default-deny; server routes authorize through
-- the immutable Hub employee identity before using reviewed service-role RPCs.

create table public.ops_tasks (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'manual'
    check (source_system in ('manual', 'call_commitment', 'quote_tool')),
  source_event_id text
    check (source_event_id is null or char_length(source_event_id) <= 256),
  title text not null
    check (
      nullif(btrim(title), '') is not null
      and char_length(title) <= 200
    ),
  detail text
    check (detail is null or char_length(detail) <= 2000),
  status text not null default 'open'
    check (status in ('open', 'blocked', 'completed', 'dismissed')),
  due_at timestamptz not null default (now() + interval '24 hours'),
  created_by_employee_id uuid not null references public.ops_employees(id),
  assigned_employee_id uuid references public.ops_employees(id),
  completed_at timestamptz,
  dismissed_at timestamptz,
  blocked_at timestamptz,
  blocked_reason text
    check (blocked_reason is null or char_length(blocked_reason) <= 500),
  dismissal_reason text
    check (dismissal_reason is null or char_length(dismissal_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_tasks_source_event_presence check (
    (source_system = 'manual' and source_event_id is null)
    or (source_system <> 'manual' and nullif(btrim(source_event_id), '') is not null)
  ),
  constraint ops_tasks_status_fields_check check (
    (
      status = 'open'
      and completed_at is null
      and dismissed_at is null
      and blocked_at is null
      and blocked_reason is null
      and dismissal_reason is null
    )
    or (
      status = 'blocked'
      and completed_at is null
      and dismissed_at is null
      and blocked_at is not null
      and nullif(btrim(blocked_reason), '') is not null
      and dismissal_reason is null
    )
    or (
      status = 'completed'
      and completed_at is not null
      and dismissed_at is null
      and blocked_at is null
      and blocked_reason is null
      and dismissal_reason is null
    )
    or (
      status = 'dismissed'
      and completed_at is null
      and dismissed_at is not null
      and blocked_at is null
      and blocked_reason is null
      and nullif(btrim(dismissal_reason), '') is not null
    )
  )
);

create unique index ops_tasks_source_event_unique
  on public.ops_tasks (source_system, source_event_id)
  where source_event_id is not null;

create index ops_tasks_creator_due_idx
  on public.ops_tasks (created_by_employee_id, due_at, id);

create index ops_tasks_assignee_due_idx
  on public.ops_tasks (assigned_employee_id, due_at, id);

create table public.ops_task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ops_tasks(id),
  event_type text not null
    check (event_type in ('created', 'assigned', 'blocked', 'completed', 'dismissed')),
  actor_employee_id uuid not null references public.ops_employees(id),
  idempotency_key uuid not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (actor_employee_id, idempotency_key)
);

create index ops_task_events_task_created_idx
  on public.ops_task_events (task_id, created_at, id);

alter table public.ops_tasks enable row level security;
alter table public.ops_tasks force row level security;
alter table public.ops_task_events enable row level security;
alter table public.ops_task_events force row level security;

revoke all privileges on table public.ops_tasks, public.ops_task_events
  from public, anon, authenticated, service_role;
grant select on table public.ops_tasks, public.ops_task_events to service_role;

-- Task identity, source provenance, assignment, deletion, and terminal rows
-- are immutable in this foundation. A later reviewed assignment workflow can
-- replace this rule without making direct service-role DML authoritative.
create function public.enforce_ops_task_transition()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '23514', message = 'task rows cannot be deleted';
  end if;

  if new.id is distinct from old.id
     or new.source_system is distinct from old.source_system
     or new.source_event_id is distinct from old.source_event_id
     or new.created_by_employee_id is distinct from old.created_by_employee_id
     or new.assigned_employee_id is distinct from old.assigned_employee_id
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '23514', message = 'task ownership and provenance are immutable';
  end if;

  if old.status in ('completed', 'dismissed') and new is distinct from old then
    raise exception using errcode = '23514', message = 'terminal task cannot change';
  end if;

  return new;
end
$function$;

revoke all on function public.enforce_ops_task_transition()
  from public, anon, authenticated, service_role;

create trigger enforce_ops_task_transition
before update or delete on public.ops_tasks
for each row execute function public.enforce_ops_task_transition();

create function public.reject_ops_task_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '23514', message = 'task audit events are immutable';
end
$function$;

revoke all on function public.reject_ops_task_event_mutation()
  from public, anon, authenticated, service_role;

create trigger reject_ops_task_event_mutation
before update or delete on public.ops_task_events
for each row execute function public.reject_ops_task_event_mutation();

create function public.ops_create_manual_task(
  p_title text,
  p_detail text,
  p_due_at timestamptz,
  p_actor_employee_id uuid,
  p_idempotency_key uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task_id uuid;
  v_existing_event_type text;
  v_existing_detail jsonb;
  v_normalized_title text := btrim(p_title);
  v_normalized_detail text := nullif(btrim(p_detail), '');
  v_request_detail jsonb;
begin
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'idempotency key is required';
  end if;
  if nullif(v_normalized_title, '') is null or char_length(v_normalized_title) > 200 then
    raise exception using errcode = '22023', message = 'task title is invalid';
  end if;
  if v_normalized_detail is not null and char_length(v_normalized_detail) > 2000 then
    raise exception using errcode = '22023', message = 'task detail is too long';
  end if;
  if not exists (
    select 1
    from public.ops_employees as employee
    where employee.id = p_actor_employee_id
      and employee.active
  ) then
    raise exception using errcode = '42501', message = 'active task actor is required';
  end if;

  v_request_detail := jsonb_build_object(
    'operation', 'create_manual',
    'title', v_normalized_title,
    'detail', v_normalized_detail,
    'due_at', p_due_at
  );

  -- Serialize first use of one actor/key pair. A concurrent retry waits for
  -- the first transaction and then returns the same durable result.
  perform pg_advisory_xact_lock(
    hashtextextended(p_actor_employee_id::text || ':' || p_idempotency_key::text, 0)
  );

  select task_id, event_type, detail
  into v_task_id, v_existing_event_type, v_existing_detail
  from public.ops_task_events
  where actor_employee_id = p_actor_employee_id
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing_event_type is distinct from 'created'
       or v_existing_detail is distinct from v_request_detail then
      raise exception using errcode = '23505', message = 'idempotency key payload conflicts';
    end if;
    return v_task_id;
  end if;

  if p_due_at is not null and p_due_at <= now() then
    raise exception using errcode = '22023', message = 'task due time must be in the future';
  end if;

  insert into public.ops_tasks (
    title,
    detail,
    due_at,
    created_by_employee_id,
    assigned_employee_id
  ) values (
    v_normalized_title,
    v_normalized_detail,
    coalesce(p_due_at, now() + interval '24 hours'),
    p_actor_employee_id,
    p_actor_employee_id
  )
  returning id into v_task_id;

  insert into public.ops_task_events (
    task_id,
    event_type,
    actor_employee_id,
    idempotency_key,
    detail
  ) values (
    v_task_id,
    'created',
    p_actor_employee_id,
    p_idempotency_key,
    v_request_detail
  );

  return v_task_id;
end
$function$;

revoke all on function public.ops_create_manual_task(text,text,timestamptz,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ops_create_manual_task(text,text,timestamptz,uuid,uuid)
  to service_role;

create function public.ops_update_own_task(
  p_task_id uuid,
  p_status text,
  p_reason text,
  p_actor_employee_id uuid,
  p_idempotency_key uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task public.ops_tasks%rowtype;
  v_existing_task_id uuid;
  v_existing_event_type text;
  v_existing_detail jsonb;
  v_normalized_reason text := nullif(btrim(p_reason), '');
  v_request_detail jsonb;
begin
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'idempotency key is required';
  end if;
  if p_status is null or p_status not in ('blocked', 'completed', 'dismissed') then
    raise exception using errcode = '22023', message = 'invalid task status action';
  end if;
  if p_status in ('blocked', 'dismissed') and v_normalized_reason is null then
    raise exception using errcode = '22023', message = 'a reason is required';
  end if;
  if p_status = 'completed' and v_normalized_reason is not null then
    raise exception using errcode = '22023', message = 'completed tasks do not accept a reason';
  end if;
  if v_normalized_reason is not null and char_length(v_normalized_reason) > 500 then
    raise exception using errcode = '22023', message = 'task reason is too long';
  end if;
  if not exists (
    select 1
    from public.ops_employees as employee
    where employee.id = p_actor_employee_id
      and employee.active
  ) then
    raise exception using errcode = '42501', message = 'active task actor is required';
  end if;

  v_request_detail := jsonb_build_object(
    'operation', 'set_status',
    'status', p_status,
    'reason', v_normalized_reason
  );

  perform pg_advisory_xact_lock(
    hashtextextended(p_actor_employee_id::text || ':' || p_idempotency_key::text, 0)
  );

  select task_id, event_type, detail
  into v_existing_task_id, v_existing_event_type, v_existing_detail
  from public.ops_task_events
  where actor_employee_id = p_actor_employee_id
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing_task_id is distinct from p_task_id
       or v_existing_event_type is distinct from p_status
       or v_existing_detail is distinct from v_request_detail then
      raise exception using errcode = '23505', message = 'idempotency key payload conflicts';
    end if;
    return v_existing_task_id;
  end if;

  select *
  into v_task
  from public.ops_tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'task does not exist';
  end if;
  if p_actor_employee_id <> v_task.created_by_employee_id
     and p_actor_employee_id is distinct from v_task.assigned_employee_id then
    raise exception using errcode = '42501', message = 'task is not owned by actor';
  end if;
  if v_task.status in ('completed', 'dismissed') then
    raise exception using errcode = '22023', message = 'terminal task cannot change';
  end if;

  update public.ops_tasks
  set
    status = p_status,
    completed_at = case when p_status = 'completed' then now() else null end,
    dismissed_at = case when p_status = 'dismissed' then now() else null end,
    dismissal_reason = case when p_status = 'dismissed' then v_normalized_reason else null end,
    blocked_at = case when p_status = 'blocked' then now() else null end,
    blocked_reason = case when p_status = 'blocked' then v_normalized_reason else null end,
    updated_at = now()
  where id = p_task_id;

  insert into public.ops_task_events (
    task_id,
    event_type,
    actor_employee_id,
    idempotency_key,
    detail
  ) values (
    p_task_id,
    p_status,
    p_actor_employee_id,
    p_idempotency_key,
    v_request_detail
  );

  return p_task_id;
end
$function$;

revoke all on function public.ops_update_own_task(uuid,text,text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ops_update_own_task(uuid,text,text,uuid,uuid)
  to service_role;
