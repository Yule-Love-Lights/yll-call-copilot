begin;

create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;

select no_plan();

insert into public.ops_employees (
  id,
  compatibility_email,
  display_name,
  role,
  active,
  membership_version,
  entity_version
) values
  (
    '96000000-0000-4000-8000-000000000001',
    'office-task-creator@example.invalid',
    'Office task creator',
    'office',
    true,
    1,
    1
  ),
  (
    '96000000-0000-4000-8000-000000000002',
    'office-task-assignee@example.invalid',
    'Office task assignee',
    'office',
    true,
    1,
    1
  ),
  (
    '96000000-0000-4000-8000-000000000003',
    'office-task-outsider@example.invalid',
    'Office task outsider',
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
) values
  (
    '96000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'active',
    1,
    now()
  ),
  (
    '96000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'active',
    1,
    now()
  ),
  (
    '96000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000001',
    'active',
    1,
    now()
  );

create temporary table office_task_test_state (
  label text primary key,
  task_id uuid not null
) on commit drop;

grant select, insert on table office_task_test_state to service_role;

select ok(
  routine.prosecdef
    and coalesce(routine.proconfig, array[]::text[])
      @> array['search_path=""']::text[],
  format('%s is SECURITY DEFINER with an empty search_path', expected.signature)
)
from (
  values
    ('public.ops_create_manual_task(text,text,timestamp with time zone,uuid,uuid)'::regprocedure),
    ('public.ops_update_own_task(uuid,text,text,uuid,uuid)'::regprocedure)
) as expected(signature)
join pg_proc as routine on routine.oid = expected.signature::oid
order by expected.signature::text;

select ok(
  not routine.prosecdef
    and coalesce(routine.proconfig, array[]::text[])
      @> array['search_path=""']::text[],
  format('%s is SECURITY INVOKER with an empty search_path', expected.signature)
)
from (
  values
    ('public.enforce_ops_task_transition()'::regprocedure),
    ('public.reject_ops_task_event_mutation()'::regprocedure)
) as expected(signature)
join pg_proc as routine on routine.oid = expected.signature::oid
order by expected.signature::text;

select ok(
  has_function_privilege(
    'service_role',
    'public.ops_create_manual_task(text,text,timestamp with time zone,uuid,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.ops_update_own_task(uuid,text,text,uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.ops_create_manual_task(text,text,timestamp with time zone,uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.ops_create_manual_task(text,text,timestamp with time zone,uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.ops_update_own_task(uuid,text,text,uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.ops_update_own_task(uuid,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'only service_role can invoke the task mutation RPCs'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.enforce_ops_task_transition()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.reject_ops_task_event_mutation()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.enforce_ops_task_transition()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.enforce_ops_task_transition()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.reject_ops_task_event_mutation()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.reject_ops_task_event_mutation()',
    'EXECUTE'
  ),
  'task trigger functions cannot be invoked directly by API roles'
);

select ok(
  has_table_privilege('service_role', format('public.%I', expected.table_name), 'SELECT')
    and not has_table_privilege('service_role', format('public.%I', expected.table_name), 'INSERT')
    and not has_table_privilege('service_role', format('public.%I', expected.table_name), 'UPDATE')
    and not has_table_privilege('service_role', format('public.%I', expected.table_name), 'DELETE')
    and not has_table_privilege('service_role', format('public.%I', expected.table_name), 'TRUNCATE')
    and not has_table_privilege('service_role', format('public.%I', expected.table_name), 'REFERENCES')
    and not has_table_privilege('service_role', format('public.%I', expected.table_name), 'TRIGGER')
    and not has_table_privilege('service_role', format('public.%I', expected.table_name), 'MAINTAIN'),
  format('service_role has read-only access to %I', expected.table_name)
)
from (values ('ops_tasks'::text), ('ops_task_events'::text)) as expected(table_name)
order by expected.table_name;

set local role service_role;
insert into office_task_test_state (label, task_id)
select
  'default-due',
  public.ops_create_manual_task(
    'Call the supplier',
    'Confirm the replacement strand',
    null,
    '96000000-0000-4000-8000-000000000001',
    '96200000-0000-4000-8000-000000000001'
  );
reset role;

select is(
  (
    select task.due_at
    from public.ops_tasks as task
    join office_task_test_state as state on state.task_id = task.id
    where state.label = 'default-due'
  ),
  (
    select task.created_at + interval '24 hours'
    from public.ops_tasks as task
    join office_task_test_state as state on state.task_id = task.id
    where state.label = 'default-due'
  ),
  'a manual task without an explicit due time defaults to exactly 24 hours after creation'
);

select ok(
  exists (
    select 1
    from public.ops_tasks as task
    join office_task_test_state as state on state.task_id = task.id
    where state.label = 'default-due'
      and task.source_system = 'manual'
      and task.source_event_id is null
      and task.status = 'open'
      and task.created_by_employee_id = '96000000-0000-4000-8000-000000000001'
      and task.assigned_employee_id = '96000000-0000-4000-8000-000000000001'
  ),
  'manual task creation records an open self-owned task without fabricated source evidence'
);

insert into public.ops_tasks (
  id,
  title,
  due_at,
  created_by_employee_id,
  assigned_employee_id
) values (
  '96100000-0000-4000-8000-000000000030',
  'Expired replay task',
  now() - interval '2 hours',
  '96000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001'
);

insert into public.ops_task_events (
  task_id,
  event_type,
  actor_employee_id,
  idempotency_key,
  detail
) values (
  '96100000-0000-4000-8000-000000000030',
  'created',
  '96000000-0000-4000-8000-000000000001',
  '96200000-0000-4000-8000-000000000030',
  jsonb_build_object(
    'operation', 'create_manual',
    'title', 'Expired replay task',
    'detail', null,
    'due_at', (
      select due_at
      from public.ops_tasks
      where id = '96100000-0000-4000-8000-000000000030'
    )
  )
);

set local role service_role;
select is(
  public.ops_create_manual_task(
    'Call the supplier',
    'Confirm the replacement strand',
    null,
    '96000000-0000-4000-8000-000000000001',
    '96200000-0000-4000-8000-000000000001'
  ),
  (
    select task_id
    from office_task_test_state
    where label = 'default-due'
  ),
  'an exact manual-create replay returns the original task'
);

select is(
  public.ops_create_manual_task(
    'Expired replay task',
    null,
    (
      select due_at
      from public.ops_tasks
      where id = '96100000-0000-4000-8000-000000000030'
    ),
    '96000000-0000-4000-8000-000000000001',
    '96200000-0000-4000-8000-000000000030'
  ),
  '96100000-0000-4000-8000-000000000030'::uuid,
  'an exact manual-create replay succeeds after its explicit due time passes'
);

select throws_ok(
  $sql$
    select public.ops_create_manual_task(
      'New expired task',
      null,
      now() - interval '1 hour',
      '96000000-0000-4000-8000-000000000001',
      '96200000-0000-4000-8000-000000000031'
    )
  $sql$,
  '22023',
  null,
  'a first-use manual task still requires a future explicit due time'
);

select throws_ok(
  $sql$
    select public.ops_create_manual_task(
      'Changed title',
      'Confirm the replacement strand',
      null,
      '96000000-0000-4000-8000-000000000001',
      '96200000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23505',
  null,
  'a changed create payload cannot reuse an idempotency key'
);

select throws_ok(
  $sql$
    select public.ops_update_own_task(
      (select task_id from office_task_test_state where label = 'default-due'),
      'completed',
      null,
      '96000000-0000-4000-8000-000000000001',
      '96200000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23505',
  null,
  'a task-update action cannot reuse a task-create idempotency key'
);
reset role;

select is(
  (
    select count(*)::bigint
    from public.ops_tasks as task
    where task.created_by_employee_id = '96000000-0000-4000-8000-000000000001'
      and task.title = 'Call the supplier'
  ),
  1::bigint,
  'an exact create replay produces only one task'
);

select is(
  (
    select count(*)::bigint
    from public.ops_task_events
    where actor_employee_id = '96000000-0000-4000-8000-000000000001'
      and idempotency_key = '96200000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'an exact create replay produces only one audit event'
);

set local role service_role;
insert into office_task_test_state (label, task_id)
select
  'update-replay',
  public.ops_create_manual_task(
    'Confirm permit status',
    null,
    now() + interval '4 hours',
    '96000000-0000-4000-8000-000000000001',
    '96200000-0000-4000-8000-000000000002'
  );

select is(
  public.ops_update_own_task(
    (select task_id from office_task_test_state where label = 'update-replay'),
    'blocked',
    'Waiting on permit office',
    '96000000-0000-4000-8000-000000000001',
    '96200000-0000-4000-8000-000000000003'
  ),
  (select task_id from office_task_test_state where label = 'update-replay'),
  'the creator can block an owned task'
);

select is(
  public.ops_update_own_task(
    (select task_id from office_task_test_state where label = 'update-replay'),
    'blocked',
    'Waiting on permit office',
    '96000000-0000-4000-8000-000000000001',
    '96200000-0000-4000-8000-000000000003'
  ),
  (select task_id from office_task_test_state where label = 'update-replay'),
  'an exact task-update replay returns the original task'
);

select throws_ok(
  $sql$
    select public.ops_update_own_task(
      (select task_id from office_task_test_state where label = 'update-replay'),
      'blocked',
      'A different blocker',
      '96000000-0000-4000-8000-000000000001',
      '96200000-0000-4000-8000-000000000003'
    )
  $sql$,
  '23505',
  null,
  'a changed reason cannot reuse a task-update idempotency key'
);

select throws_ok(
  $sql$
    select public.ops_update_own_task(
      (select task_id from office_task_test_state where label = 'update-replay'),
      'completed',
      null,
      '96000000-0000-4000-8000-000000000001',
      '96200000-0000-4000-8000-000000000003'
    )
  $sql$,
  '23505',
  null,
  'a changed action cannot reuse a task-update idempotency key'
);
reset role;

select is(
  (
    select count(*)::bigint
    from public.ops_task_events
    where actor_employee_id = '96000000-0000-4000-8000-000000000001'
      and idempotency_key = '96200000-0000-4000-8000-000000000003'
  ),
  1::bigint,
  'an exact task-update replay produces only one audit event'
);

select ok(
  exists (
    select 1
    from public.ops_tasks as task
    join office_task_test_state as state on state.task_id = task.id
    where state.label = 'update-replay'
      and task.status = 'blocked'
      and task.blocked_reason = 'Waiting on permit office'
  ),
  'conflicting replays cannot change the accepted blocked state'
);

insert into public.ops_tasks (
  id,
  title,
  created_by_employee_id,
  assigned_employee_id
) values
  (
    '96100000-0000-4000-8000-000000000001',
    'Creator-owned reassigned task',
    '96000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000002'
  ),
  (
    '96100000-0000-4000-8000-000000000002',
    'Assignee-owned task',
    '96000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000002'
  ),
  (
    '96100000-0000-4000-8000-000000000003',
    'Outsider-protected task',
    '96000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000002'
  );

set local role service_role;
select is(
  public.ops_update_own_task(
    '96100000-0000-4000-8000-000000000001',
    'blocked',
    'Creator is following up',
    '96000000-0000-4000-8000-000000000001',
    '96200000-0000-4000-8000-000000000004'
  ),
  '96100000-0000-4000-8000-000000000001'::uuid,
  'the creator can act after a task is assigned to another employee'
);

select is(
  public.ops_update_own_task(
    '96100000-0000-4000-8000-000000000002',
    'completed',
    null,
    '96000000-0000-4000-8000-000000000002',
    '96200000-0000-4000-8000-000000000005'
  ),
  '96100000-0000-4000-8000-000000000002'::uuid,
  'the assignee can complete a task created by another employee'
);

select throws_ok(
  $sql$
    select public.ops_update_own_task(
      '96100000-0000-4000-8000-000000000003',
      'blocked',
      'Outsider must not write',
      '96000000-0000-4000-8000-000000000003',
      '96200000-0000-4000-8000-000000000006'
    )
  $sql$,
  '42501',
  null,
  'an employee who is neither creator nor assignee cannot act on a task'
);
reset role;

select is(
  (select status from public.ops_tasks where id = '96100000-0000-4000-8000-000000000003'),
  'open',
  'an unauthorized task action leaves the task unchanged'
);

select is(
  (
    select count(*)::bigint
    from public.ops_task_events
    where idempotency_key = '96200000-0000-4000-8000-000000000006'
  ),
  0::bigint,
  'an unauthorized task action writes no audit event'
);

set local role service_role;
select throws_ok(
  $sql$
    update public.ops_tasks
    set assigned_employee_id = '96000000-0000-4000-8000-000000000003'
    where id = '96100000-0000-4000-8000-000000000003'
  $sql$,
  '42501',
  null,
  'service_role cannot bypass the RPC to change task ownership directly'
);
reset role;

select throws_ok(
  $sql$
    update public.ops_tasks
    set assigned_employee_id = '96000000-0000-4000-8000-000000000003'
    where id = '96100000-0000-4000-8000-000000000003'
  $sql$,
  '23514',
  null,
  'the task transition guard rejects an ownership rewrite by a privileged writer'
);

set local role service_role;
select is(
  public.ops_update_own_task(
    (select task_id from office_task_test_state where label = 'default-due'),
    'completed',
    null,
    '96000000-0000-4000-8000-000000000001',
    '96200000-0000-4000-8000-000000000007'
  ),
  (select task_id from office_task_test_state where label = 'default-due'),
  'an owner can complete an open task'
);

select is(
  public.ops_update_own_task(
    (select task_id from office_task_test_state where label = 'default-due'),
    'completed',
    null,
    '96000000-0000-4000-8000-000000000001',
    '96200000-0000-4000-8000-000000000007'
  ),
  (select task_id from office_task_test_state where label = 'default-due'),
  'an exact completion replay succeeds after the task is terminal'
);

select throws_ok(
  $sql$
    select public.ops_update_own_task(
      (select task_id from office_task_test_state where label = 'default-due'),
      'blocked',
      'Must remain terminal',
      '96000000-0000-4000-8000-000000000001',
      '96200000-0000-4000-8000-000000000008'
    )
  $sql$,
  '22023',
  null,
  'a completed task rejects a later mutation'
);

insert into office_task_test_state (label, task_id)
select
  'dismissed-terminal',
  public.ops_create_manual_task(
    'Remove obsolete reminder',
    null,
    null,
    '96000000-0000-4000-8000-000000000001',
    '96200000-0000-4000-8000-000000000009'
  );

select is(
  public.ops_update_own_task(
    (select task_id from office_task_test_state where label = 'dismissed-terminal'),
    'dismissed',
    'No longer needed',
    '96000000-0000-4000-8000-000000000001',
    '96200000-0000-4000-8000-000000000010'
  ),
  (select task_id from office_task_test_state where label = 'dismissed-terminal'),
  'an owner can dismiss a task with a reason'
);

select is(
  public.ops_update_own_task(
    (select task_id from office_task_test_state where label = 'dismissed-terminal'),
    'dismissed',
    'No longer needed',
    '96000000-0000-4000-8000-000000000001',
    '96200000-0000-4000-8000-000000000010'
  ),
  (select task_id from office_task_test_state where label = 'dismissed-terminal'),
  'an exact dismissal replay succeeds after the task is terminal'
);

select throws_ok(
  $sql$
    select public.ops_update_own_task(
      (select task_id from office_task_test_state where label = 'dismissed-terminal'),
      'completed',
      null,
      '96000000-0000-4000-8000-000000000001',
      '96200000-0000-4000-8000-000000000011'
    )
  $sql$,
  '22023',
  null,
  'a dismissed task rejects a later mutation'
);
reset role;

select throws_ok(
  $sql$
    update public.ops_tasks
    set status = 'open', completed_at = null, updated_at = now()
    where id = (select task_id from office_task_test_state where label = 'default-due')
  $sql$,
  '23514',
  null,
  'the table transition guard prevents reopening a completed task'
);

select throws_ok(
  $sql$
    update public.ops_tasks
    set
      status = 'open',
      dismissed_at = null,
      dismissal_reason = null,
      updated_at = now()
    where id = (select task_id from office_task_test_state where label = 'dismissed-terminal')
  $sql$,
  '23514',
  null,
  'the table transition guard prevents reopening a dismissed task'
);

set local role service_role;
insert into office_task_test_state (label, task_id)
select
  'reason-validation',
  public.ops_create_manual_task(
    'Reason validation task',
    null,
    null,
    '96000000-0000-4000-8000-000000000001',
    '96200000-0000-4000-8000-000000000012'
  );

select throws_ok(
  $sql$
    select public.ops_update_own_task(
      (select task_id from office_task_test_state where label = 'reason-validation'),
      'blocked',
      null,
      '96000000-0000-4000-8000-000000000001',
      '96200000-0000-4000-8000-000000000013'
    )
  $sql$,
  '22023',
  null,
  'the task RPC rejects a null block reason'
);

select throws_ok(
  $sql$
    select public.ops_update_own_task(
      (select task_id from office_task_test_state where label = 'reason-validation'),
      'blocked',
      '   ',
      '96000000-0000-4000-8000-000000000001',
      '96200000-0000-4000-8000-000000000014'
    )
  $sql$,
  '22023',
  null,
  'the task RPC rejects a blank block reason'
);

select throws_ok(
  $sql$
    select public.ops_update_own_task(
      (select task_id from office_task_test_state where label = 'reason-validation'),
      'dismissed',
      null,
      '96000000-0000-4000-8000-000000000001',
      '96200000-0000-4000-8000-000000000015'
    )
  $sql$,
  '22023',
  null,
  'the task RPC rejects a null dismissal reason'
);

select throws_ok(
  $sql$
    select public.ops_update_own_task(
      (select task_id from office_task_test_state where label = 'reason-validation'),
      'dismissed',
      '   ',
      '96000000-0000-4000-8000-000000000001',
      '96200000-0000-4000-8000-000000000016'
    )
  $sql$,
  '22023',
  null,
  'the task RPC rejects a blank dismissal reason'
);
reset role;

select throws_ok(
  $sql$
    insert into public.ops_tasks (
      id,
      title,
      status,
      blocked_at,
      blocked_reason,
      created_by_employee_id,
      assigned_employee_id
    ) values (
      '96100000-0000-4000-8000-000000000010',
      'Invalid blocked task',
      'blocked',
      now(),
      '   ',
      '96000000-0000-4000-8000-000000000001',
      '96000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514',
  null,
  'the task table rejects a blank block reason'
);

select throws_ok(
  $sql$
    insert into public.ops_tasks (
      id,
      title,
      status,
      dismissed_at,
      dismissal_reason,
      created_by_employee_id,
      assigned_employee_id
    ) values (
      '96100000-0000-4000-8000-000000000011',
      'Invalid dismissed task',
      'dismissed',
      now(),
      '   ',
      '96000000-0000-4000-8000-000000000001',
      '96000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514',
  null,
  'the task table rejects a blank dismissal reason'
);

insert into public.ops_tasks (
  id,
  source_system,
  source_event_id,
  title,
  created_by_employee_id,
  assigned_employee_id
) values (
  '96100000-0000-4000-8000-000000000020',
  'call_commitment',
  'call-event-001',
  'Future call-origin task evidence',
  '96000000-0000-4000-8000-000000000001',
  null
);

select throws_ok(
  $sql$
    insert into public.ops_tasks (
      id,
      source_system,
      source_event_id,
      title,
      created_by_employee_id,
      assigned_employee_id
    ) values (
      '96100000-0000-4000-8000-000000000021',
      'call_commitment',
      'call-event-001',
      'Duplicate future call-origin task evidence',
      '96000000-0000-4000-8000-000000000001',
      null
    )
  $sql$,
  '23505',
  null,
  'one call source event can project to at most one Hub task'
);

insert into public.ops_tasks (
  id,
  source_system,
  source_event_id,
  title,
  created_by_employee_id,
  assigned_employee_id
) values (
  '96100000-0000-4000-8000-000000000022',
  'quote_tool',
  'quote-event-001',
  'Future Quote Tool task evidence',
  '96000000-0000-4000-8000-000000000001',
  null
);

select throws_ok(
  $sql$
    insert into public.ops_tasks (
      id,
      source_system,
      source_event_id,
      title,
      created_by_employee_id,
      assigned_employee_id
    ) values (
      '96100000-0000-4000-8000-000000000023',
      'quote_tool',
      'quote-event-001',
      'Duplicate future Quote Tool task evidence',
      '96000000-0000-4000-8000-000000000001',
      null
    )
  $sql$,
  '23505',
  null,
  'one Quote Tool source event can project to at most one Hub task'
);

select throws_ok(
  $sql$
    update public.ops_task_events
    set detail = jsonb_build_object('tampered', true)
    where idempotency_key = '96200000-0000-4000-8000-000000000001'
  $sql$,
  '23514',
  null,
  'task audit events reject updates'
);

select throws_ok(
  $sql$
    delete from public.ops_task_events
    where idempotency_key = '96200000-0000-4000-8000-000000000001'
  $sql$,
  '23514',
  null,
  'task audit events reject deletes'
);

select throws_ok(
  $sql$
    delete from public.ops_tasks
    where id = (select task_id from office_task_test_state where label = 'default-due')
  $sql$,
  '23514',
  null,
  'tasks cannot be deleted with their audit history'
);

select ok(
  exists (
    select 1
    from public.ops_tasks as task
    join office_task_test_state as state on state.task_id = task.id
    where state.label = 'default-due'
  )
  and exists (
    select 1
    from public.ops_task_events
    where idempotency_key = '96200000-0000-4000-8000-000000000001'
  ),
  'failed tampering leaves both the task and its original audit event intact'
);

select * from finish();
rollback;
