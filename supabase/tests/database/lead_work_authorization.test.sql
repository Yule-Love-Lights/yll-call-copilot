begin;

create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;

select no_plan();

create temporary table expected_lead_work_routines (
  routine_signature text primary key
) on commit drop;

insert into expected_lead_work_routines (routine_signature) values
  ('abandon_owned_live_attempt(uuid,text,uuid)'),
  ('append_authorized_live_segment(uuid,uuid,text,text,integer,integer)'),
  ('assert_legacy_metric_artifacts_reconciled()'),
  ('assert_personal_touch_metric_provenance()'),
  ('begin_owned_followup_send(uuid,text,uuid,uuid)'),
  ('complete_owned_lead_call(uuid,text,text,uuid,uuid,uuid,text,text,text,text,boolean)'),
  ('consume_authorized_live_dial(text,text,text,text,text,text)'),
  ('consume_authorized_live_stream(uuid,text)'),
  ('decide_queued_lead(uuid,text,text,uuid,text,text,boolean,text)'),
  ('end_owned_live_attempt(uuid,text,uuid)'),
  ('enforce_call_metric_scope()'),
  ('enforce_call_score_metric_scope()'),
  ('enforce_followup_provider_message_immutable()'),
  ('enforce_live_session_transition()'),
  ('enforce_transcript_metric_scope()'),
  ('finish_owned_followup_send(uuid,text,uuid,uuid,text,text)'),
  ('is_contact_calling_time_allowed(timestamp with time zone,text)'),
  ('reject_live_segment_mutation()'),
  ('start_claimed_live_attempt(uuid,text,text,uuid,text,uuid)'),
  ('update_owned_followup_draft(uuid,text,uuid,text,text)');

select is(
  (
    select count(*)::bigint
    from pg_proc as routine
    join pg_namespace as namespace on namespace.oid = routine.pronamespace
    join expected_lead_work_routines as expected
      on expected.routine_signature = routine.oid::regprocedure::text
    where namespace.nspname = 'public'
      and routine.prosecdef
  ),
  0::bigint,
  'every lead-work routine is SECURITY INVOKER'
);

select is(
  (
    select count(*)::bigint
    from pg_proc as routine
    join pg_namespace as namespace on namespace.oid = routine.pronamespace
    join expected_lead_work_routines as expected
      on expected.routine_signature = routine.oid::regprocedure::text
    where namespace.nspname = 'public'
      and not coalesce(routine.proconfig, array[]::text[])
        @> array['search_path=""']::text[]
  ),
  0::bigint,
  'every lead-work routine has an empty search_path'
);

select ok(
  not has_function_privilege('anon', routine_signature, 'EXECUTE')
    and not has_function_privilege('authenticated', routine_signature, 'EXECUTE')
    and has_function_privilege('service_role', routine_signature, 'EXECUTE'),
  format('%s is executable only by service_role', routine_signature)
)
from expected_lead_work_routines
order by routine_signature;

select ok(
  not has_table_privilege('service_role', 'public.live_segments', 'UPDATE')
    and not has_table_privilege('service_role', 'public.live_segments', 'DELETE')
    and not has_table_privilege('service_role', 'public.live_segments', 'TRUNCATE')
    and has_table_privilege('service_role', 'public.live_segments', 'SELECT')
    and has_table_privilege('service_role', 'public.live_segments', 'INSERT'),
  'live_segments is append-only for service_role'
);

select is(
  (
    select column_default::text
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'calls'
      and column_name = 'metric_scope'
  ),
  null::text,
  'calls.metric_scope has no permissive default'
);

select is(
  (
    select column_default::text
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transcripts'
      and column_name = 'metric_scope'
  ),
  null::text,
  'transcripts.metric_scope has no permissive default'
);

select is(
  (
    select column_default::text
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'call_scores'
      and column_name = 'metric_scope'
  ),
  null::text,
  'call_scores.metric_scope has no permissive default'
);

select is(
  (
    select count(*)::bigint
    from information_schema.columns
    where table_schema = 'public'
      and (
        (table_name = 'calls' and column_name = 'metric_scope')
        or (table_name = 'transcripts' and column_name = 'metric_scope')
        or (table_name = 'call_scores' and column_name = 'metric_scope')
      )
      and is_nullable = 'NO'
  ),
  3::bigint,
  'all metric-scope columns are required after backfill'
);

select is(
  (
    select count(*)::bigint
    from pg_constraint as constraint_record
    where constraint_record.conrelid in (
      'public.calls'::regclass,
      'public.transcripts'::regclass,
      'public.call_scores'::regclass
    )
      and constraint_record.conname in (
        'calls_metric_scope_check',
        'transcripts_metric_scope_check',
        'call_scores_metric_scope_check'
      )
      and constraint_record.convalidated
  ),
  3::bigint,
  'all metric-scope positive allowlists are validated'
);

insert into public.app_users (id, email, role) values
  ('10000000-0000-0000-0000-000000000001', 'rep-one@example.invalid', 'office'),
  ('10000000-0000-0000-0000-000000000002', 'rep-two@example.invalid', 'office');

insert into public.leads (
  id,
  full_name,
  phone,
  reason,
  source,
  status,
  timezone
) values
  (
    '20000000-0000-0000-0000-000000000001',
    'Test Lead One',
    '+15555550101',
    'authorization test',
    'inbound',
    'queued',
    'UTC'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    'Test Lead Two',
    '+15555550102',
    'manual completion test',
    'inbound',
    'queued',
    'UTC'
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    'Test Lead Three',
    '+15555550103',
    'abandon test',
    'quote_followup',
    'queued',
    'UTC'
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    'Test Lead Four',
    '+15555550104',
    'idempotency transcript test',
    'quote_followup',
    'queued',
    'UTC'
  ),
  (
    '20000000-0000-0000-0000-000000000005',
    'Test Lead Five',
    '+15555550105',
    'calling-hours test',
    'inbound',
    'queued',
    'UTC'
  ),
  (
    '20000000-0000-0000-0000-000000000006',
    'Test Lead Six',
    '+15555550106',
    'claimed-dismiss ownership test',
    'inbound',
    'queued',
    'UTC'
  );

-- Pick a real IANA zone whose current local time is safely inside the DB
-- calling window. The routine itself still tests/falls back invalid zones.
update public.leads
set timezone = (
  select timezone_record.name
  from pg_timezone_names as timezone_record
  where (clock_timestamp() at time zone timezone_record.name)::time
    >= time '10:00'
    and (clock_timestamp() at time zone timezone_record.name)::time
    < time '18:00'
  order by timezone_record.name
  limit 1
)
where id in (
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000004',
  '20000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000006'
);

update public.leads
set ghl_contact_id = case id
      when '20000000-0000-0000-0000-000000000001'::uuid
        then 'ghl-contact-test-one'
      when '20000000-0000-0000-0000-000000000002'::uuid
        then 'ghl-contact-test-two'
      when '20000000-0000-0000-0000-000000000003'::uuid
        then 'ghl-contact-test-three'
      when '20000000-0000-0000-0000-000000000004'::uuid
        then 'ghl-contact-test-four'
      when '20000000-0000-0000-0000-000000000005'::uuid
        then 'ghl-contact-test-five'
      when '20000000-0000-0000-0000-000000000006'::uuid
        then 'ghl-contact-test-six'
    end
where id in (
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000004',
  '20000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000006'
);

set local role service_role;

select is(
  (
    select result_code
    from public.decide_queued_lead(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000001',
      null,
      null,
      false,
      null
    )
  ),
  'invalid_input',
  'NULL queue action fails closed'
);

select is(
  (
    select result_code
    from public.complete_owned_lead_call(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000099',
      null,
      null,
      '',
      null,
      null,
      false
    )
  ),
  'invalid_input',
  'NULL call outcome fails closed'
);

select is(
  (
    select result_code
    from public.decide_queued_lead(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000001',
      'claim',
      'ghl-contact-test-one',
      false,
      null
    )
  ),
  'claim_not_authorized',
  'claim requires a current positive GHL call-permission decision'
);

select is(
  (
    select result_code
    from public.decide_queued_lead(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000001',
      'claim',
      'stale-or-different-contact',
      true,
      null
    )
  ),
  'claim_not_authorized',
  'claim binds the current permission decision to the locked lead contact'
);

select ok(
  public.is_contact_calling_time_allowed(
    '2026-01-15 08:00:00+00'::timestamptz,
    'UTC'
  ),
  '08:00 contact-local time is allowed'
);

select ok(
  public.is_contact_calling_time_allowed(
    '2026-01-15 20:59:59.999+00'::timestamptz,
    'UTC'
  ),
  'the calling window remains open immediately before 21:00'
);

select ok(
  not public.is_contact_calling_time_allowed(
    '2026-01-15 07:59:59.999+00'::timestamptz,
    'UTC'
  ),
  'contact-local time immediately before 08:00 is rejected'
);

select ok(
  not public.is_contact_calling_time_allowed(
    '2026-01-15 21:00:00+00'::timestamptz,
    'UTC'
  ),
  '21:00 contact-local time is rejected'
);

select ok(
  not public.is_contact_calling_time_allowed(
    '2026-01-15 12:00:00+00'::timestamptz,
    'not/a-real-timezone'
  ),
  'an invalid IANA timezone fails closed in the calling-window helper'
);

select is(
  (
    select result_code
    from public.decide_queued_lead(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000005',
      'claim',
      'ghl-contact-test-five',
      true,
      (
        select timezone_record.name
        from pg_timezone_names as timezone_record
        where (clock_timestamp() at time zone timezone_record.name)::time
          < time '08:00'
          or (clock_timestamp() at time zone timezone_record.name)::time
            >= time '21:00'
        order by timezone_record.name
        limit 1
      )
    )
  ),
  'outside_calling_hours',
  'claim fails closed when the verified contact timezone is outside 08:00-21:00'
);

select is(
  (
    select status
    from public.leads
    where id = '20000000-0000-0000-0000-000000000005'
  ),
  'queued',
  'an after-hours claim leaves the lead queued'
);

select is(
  (
    select result_code
    from public.decide_queued_lead(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000005',
      'dismiss',
      null,
      false,
      'not/a-real-timezone'
    )
  ),
  'dismissed',
  'dismiss ignores call permission and timezone because it initiates no contact'
);

select is(
  (
    select result_code
    from public.decide_queued_lead(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000006',
      'claim',
      'ghl-contact-test-six',
      true,
      null
    )
  ),
  'claimed',
  'the ownership-release test lead is claimed by its exact actor'
);

select is(
  (
    select result_code
    from public.decide_queued_lead(
      '10000000-0000-0000-0000-000000000002',
      'auth-user-two',
      'rep-two@example.invalid',
      '20000000-0000-0000-0000-000000000006',
      'dismiss',
      null,
      false,
      null
    )
  ),
  'not_owned',
  'a foreign actor cannot dismiss another employee claimed lead'
);

select is(
  (
    select status
    from public.leads
    where id = '20000000-0000-0000-0000-000000000006'
  ),
  'claimed',
  'a foreign dismiss attempt leaves the original claim intact'
);

select is(
  (
    select result_code
    from public.decide_queued_lead(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000006',
      'dismiss',
      null,
      false,
      null
    )
  ),
  'dismissed',
  'the exact claim owner can release a claimed lead without initiating contact'
);

select is(
  (
    select result_code
    from public.decide_queued_lead(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000001',
      'claim',
      'ghl-contact-test-one',
      true,
      (
        select lead_record.timezone
        from public.leads as lead_record
        where lead_record.id = '20000000-0000-0000-0000-000000000001'
      )
    )
  ),
  'claimed',
  'an Office actor can atomically claim a queued lead'
);

select is(
  (
    select ghl_contact_id
    from public.leads
    where id = '20000000-0000-0000-0000-000000000001'
  ),
  'ghl-contact-test-one',
  'claim permission validation does not replace the locked contact binding'
);

select is(
  (
    select claimed_employee_id
    from public.leads
    where id = '20000000-0000-0000-0000-000000000001'
  ),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'claim stores the immutable employee owner'
);

select ok(
  (
    select
      result_code = 'starting'
      and call_id is not null
      and session_id is not null
    from public.start_claimed_live_attempt(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000001',
      'dial-grant-hash-one',
      '30000000-0000-0000-0000-000000000001'
    )
  ),
  'fresh start creates one Twilio attempt and returns its non-null ids'
);

select ok(
  (
    select call_id is not null and session_id is not null
    from public.start_claimed_live_attempt(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000001',
      'dial-grant-hash-one',
      '30000000-0000-0000-0000-000000000001'
    )
  ),
  'fresh/recovered start returns non-null call and session ids'
);

select is(
  (
    select result_code
    from public.start_claimed_live_attempt(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000001',
      'unrelated-dial-grant',
      '30000000-0000-0000-0000-000000000099'
    )
  ),
  'start_conflict',
  'a different client start request cannot rotate an open attempt grant'
);

select is(
  (
    select result_code
    from public.start_claimed_live_attempt(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000001',
      'dial-grant-hash-one',
      '30000000-0000-0000-0000-000000000001'
    )
  ),
  'starting',
  'a lost start response recovers only the exact idempotency payload'
);

select is(
  (
    select count(*)::bigint
    from public.live_sessions
    where lead_id = '20000000-0000-0000-0000-000000000001'
      and status in ('starting', 'active', 'pending_outcome')
  ),
  1::bigint,
  'one lead has only one open attempt'
);

select is(
  (
    select result_code
    from public.consume_authorized_live_dial(
      'dial-grant-hash-one',
      'auth-user-one',
      'media-grant-hash-one',
      'wrong-ghl-contact',
      '+15555550101',
      (
        select timezone
        from public.leads
        where id = '20000000-0000-0000-0000-000000000001'
      )
    )
  ),
  'contact_binding_mismatch',
  'dial authorization rejects a mismatched current GHL contact binding'
);

select is(
  (
    select result_code
    from public.consume_authorized_live_dial(
      'dial-grant-hash-one',
      'auth-user-one',
      'media-grant-hash-one',
      'ghl-contact-test-one',
      '+15555550101',
      (
        select timezone
        from public.leads
        where id = '20000000-0000-0000-0000-000000000001'
      )
    )
  ),
  'authorized',
  'dial grant consumption transitions starting to active'
);

select is(
  (
    select result_code
    from public.consume_authorized_live_dial(
      'dial-grant-hash-one',
      'auth-user-one',
      'media-grant-hash-one',
      'ghl-contact-test-one',
      '+15555550101',
      (
        select timezone
        from public.leads
        where id = '20000000-0000-0000-0000-000000000001'
      )
    )
  ),
  'already_authorized',
  'an exact lost dial response retry returns the consumed authorization'
);

select is(
  (
    select to_number
    from public.consume_authorized_live_dial(
      'dial-grant-hash-one',
      'auth-user-one',
      'media-grant-hash-one',
      'ghl-contact-test-one',
      '+15555550101',
      (
        select timezone
        from public.leads
        where id = '20000000-0000-0000-0000-000000000001'
      )
    )
  ),
  '+15555550101',
  'an exact dial retry returns the frozen verified destination'
);

select is(
  (
    select result_code
    from public.consume_authorized_live_dial(
      'dial-grant-hash-one',
      'auth-user-one',
      'different-media-grant',
      'ghl-contact-test-one',
      '+15555550101',
      (
        select timezone
        from public.leads
        where id = '20000000-0000-0000-0000-000000000001'
      )
    )
  ),
  'replay_rejected',
  'a consumed dial grant rejects a different media hash replay'
);

select is(
  (
    select direction
    from public.calls
    where lead_id = '20000000-0000-0000-0000-000000000001'
  ),
  'outbound',
  'a coached call is outbound even when the lead source is inbound'
);

select is(
  (
    select result_code
    from public.consume_authorized_live_stream(
      (
        select id
        from public.live_sessions
        where lead_id = '20000000-0000-0000-0000-000000000001'
      ),
      'media-grant-hash-one'
    )
  ),
  'authorized',
  'stream grant is consumed once against the active session'
);

select is(
  (
    select result_code
    from public.append_authorized_live_segment(
      (
        select id
        from public.live_sessions
        where lead_id = '20000000-0000-0000-0000-000000000001'
      ),
      '30000000-0000-0000-0000-000000000099',
      null,
      'must fail',
      100,
      null
    )
  ),
  'invalid_input',
  'NULL live-segment speaker fails closed'
);

select is(
  (
    select result_code
    from public.consume_authorized_live_stream(
      (
        select id
        from public.live_sessions
        where lead_id = '20000000-0000-0000-0000-000000000001'
      ),
      'media-grant-hash-one'
    )
  ),
  'already_authorized',
  'an exact lost stream authorization response is recoverable'
);

select is(
  (
    select result_code
    from public.consume_authorized_live_stream(
      (
        select id
        from public.live_sessions
        where lead_id = '20000000-0000-0000-0000-000000000001'
      ),
      'different-media-grant'
    )
  ),
  'replay_rejected',
  'a stream authorization rejects a different hash replay'
);

select is(
  (
    select result_code
    from public.append_authorized_live_segment(
      (
        select id
        from public.live_sessions
        where lead_id = '20000000-0000-0000-0000-000000000001'
      ),
      '30000000-0000-0000-0000-000000000001',
      'rep',
      'Hello there',
      100,
      null
    )
  ),
  'saved',
  'the bridge appends an authorized immutable segment'
);

select is(
  (
    select inserted
    from public.append_authorized_live_segment(
      (
        select id
        from public.live_sessions
        where lead_id = '20000000-0000-0000-0000-000000000001'
      ),
      '30000000-0000-0000-0000-000000000001',
      'rep',
      'Hello there',
      100,
      null
    )
  ),
  false,
  'a segment retry returns the existing segment without duplication'
);

select is(
  (
    select result_code
    from public.append_authorized_live_segment(
      (
        select id
        from public.live_sessions
        where lead_id = '20000000-0000-0000-0000-000000000001'
      ),
      '30000000-0000-0000-0000-000000000001',
      'customer',
      'Changed retry payload',
      101,
      12
    )
  ),
  'segment_conflict',
  'a reused source segment id rejects changed immutable content'
);

select is(
  (
    select count(*)::bigint
    from public.live_segments
    where session_id = (
      select id
      from public.live_sessions
      where lead_id = '20000000-0000-0000-0000-000000000001'
    )
  ),
  1::bigint,
  'segment idempotency leaves one immutable row'
);

select is(
  (
    select result_code
    from public.abandon_owned_live_attempt(
      '10000000-0000-0000-0000-000000000001',
      'rep-one@example.invalid',
      (
        select id
        from public.live_sessions
        where lead_id = '20000000-0000-0000-0000-000000000001'
      )
    )
  ),
  'real_call_cannot_abandon',
  'an active real call cannot be destroyed through abandon'
);

select is(
  (
    select result_code
    from public.end_owned_live_attempt(
      '10000000-0000-0000-0000-000000000002',
      'rep-two@example.invalid',
      (
        select id
        from public.live_sessions
        where lead_id = '20000000-0000-0000-0000-000000000001'
      )
    )
  ),
  'not_owned',
  'another employee cannot end the call'
);

select is(
  (
    select status
    from public.end_owned_live_attempt(
      '10000000-0000-0000-0000-000000000001',
      'rep-one@example.invalid',
      (
        select id
        from public.live_sessions
        where lead_id = '20000000-0000-0000-0000-000000000001'
      )
    )
  ),
  'pending_outcome',
  'the owner atomically ends the call into pending outcome'
);

select is(
  (
    select transcript_record.direction
    from public.calls as call_record
    join public.transcripts as transcript_record
      on transcript_record.id = call_record.transcript_id
    where call_record.lead_id = '20000000-0000-0000-0000-000000000001'
  ),
  'outbound',
  'the live transcript direction matches the outbound coached call'
);

select is(
  (
    select transcript_record.called_at
      = session_record.dial_started_at
    from public.calls as call_record
    join public.live_sessions as session_record
      on session_record.call_id = call_record.id
    join public.transcripts as transcript_record
      on transcript_record.id = call_record.transcript_id
    where call_record.lead_id = '20000000-0000-0000-0000-000000000001'
  ),
  true,
  'live transcript timing begins at dial consumption, not authorization start'
);

select is(
  (
    select result_code
    from public.complete_owned_lead_call(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      (
        select id
        from public.live_sessions
        where lead_id = '20000000-0000-0000-0000-000000000001'
      ),
      'interested',
      'Follow up tomorrow',
      null,
      null,
      false
    )
  ),
  'completed',
  'live completion records outcome after dial even if permission later changes'
);

-- Manual completion has the same actor/claim boundary and a client request id
-- that makes call and transcript insertion idempotent.
select is(
  (
    select result_code
    from public.decide_queued_lead(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000002',
      'claim',
      'ghl-contact-test-two',
      true,
      'not/a-real-timezone'
    )
  ),
  'claimed',
  'manual-call lead is claimed by the same actor'
);

select is(
  (
    select result_code
    from public.complete_owned_lead_call(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000002',
      '40000000-0000-0000-0000-000000000002',
      null,
      'callback',
      'Manual call notes',
      'rep: Hello\ncustomer: Call me tomorrow',
      null,
      false
    )
  ),
  'call_not_authorized',
  'a fresh completion probe requires current positive call permission'
);

select is(
  (
    select count(*)::bigint
    from public.calls
    where completion_request_id = '40000000-0000-0000-0000-000000000002'
  ),
  0::bigint,
  'the false fresh completion probe performs no call write'
);

select is(
  (
    select result_code
    from public.complete_owned_lead_call(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000002',
      '40000000-0000-0000-0000-000000000002',
      null,
      'callback',
      'Manual call notes',
      'rep: Hello\ncustomer: Call me tomorrow',
      'ghl-contact-test-two',
      true
    )
  ),
  'completed',
  'manual call and transcript complete in one transaction'
);

select is(
  (
    select result_code
    from public.complete_owned_lead_call(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000002',
      '40000000-0000-0000-0000-000000000002',
      null,
      'callback',
      'Manual call notes',
      'rep: Hello\ncustomer: Call me tomorrow',
      null,
      false
    )
  ),
  'already_completed',
  'manual completion retry remains idempotent after lead becomes done or opts out'
);

select is(
  (
    select result_code
    from public.complete_owned_lead_call(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000002',
      '40000000-0000-0000-0000-000000000002',
      null,
      'callback',
      'Manual call notes',
      'rep: Changed transcript',
      null,
      false
    )
  ),
  'request_conflict',
  'same request id rejects changed transcript content'
);

select is(
  (
    select result_code
    from public.complete_owned_lead_call(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000002',
      '40000000-0000-0000-0000-000000000002',
      null,
      'callback',
      'Manual call notes',
      null,
      null,
      false
    )
  ),
  'request_conflict',
  'same request id rejects removal of an existing transcript'
);

select is(
  (
    select count(*)::bigint
    from public.calls
    where completion_request_id = '40000000-0000-0000-0000-000000000002'
  ),
  1::bigint,
  'manual retry creates one call'
);

select is(
  (
    select count(*)::bigint
    from public.transcripts
    where id = (
      select transcript_id
      from public.calls
      where completion_request_id = '40000000-0000-0000-0000-000000000002'
    )
  ),
  1::bigint,
  'manual retry creates one transcript'
);

select is(
  (
    select direction
    from public.calls
    where completion_request_id = '40000000-0000-0000-0000-000000000002'
  ),
  'outbound',
  'an employee console callback remains outbound for an inbound-origin lead'
);

select is(
  (
    select transcript_record.direction
    from public.calls as call_record
    join public.transcripts as transcript_record
      on transcript_record.id = call_record.transcript_id
    where call_record.completion_request_id
      = '40000000-0000-0000-0000-000000000002'
  ),
  'outbound',
  'manual callback transcript direction matches its outbound call'
);

select is(
  (
    select result_code
    from public.decide_queued_lead(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000004',
      'claim',
      'ghl-contact-test-four',
      true,
      null
    )
  ),
  'claimed',
  'no-transcript idempotency lead is claimed'
);

select is(
  (
    select result_code
    from public.complete_owned_lead_call(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000004',
      '40000000-0000-0000-0000-000000000004',
      null,
      'no_answer',
      '',
      null,
      'ghl-contact-test-four',
      true
    )
  ),
  'completed',
  'manual call can complete without a transcript'
);

select is(
  (
    select result_code
    from public.complete_owned_lead_call(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000004',
      '40000000-0000-0000-0000-000000000004',
      null,
      'no_answer',
      '',
      'rep: Added later',
      null,
      false
    )
  ),
  'request_conflict',
  'same request id rejects adding a transcript after completion'
);

-- A still-starting authorization can be explicitly abandoned, but an active
-- or pending real call cannot.
select is(
  (
    select result_code
    from public.decide_queued_lead(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000003',
      'claim',
      'ghl-contact-test-three',
      true,
      null
    )
  ),
  'claimed',
  'abandon-test lead is claimed'
);

select is(
  (
    select result_code
    from public.start_claimed_live_attempt(
      '10000000-0000-0000-0000-000000000001',
      'auth-user-one',
      'rep-one@example.invalid',
      '20000000-0000-0000-0000-000000000003',
      'dial-grant-hash-abandon',
      '30000000-0000-0000-0000-000000000003'
    )
  ),
  'starting',
  'abandon-test attempt starts'
);

select is(
  (
    select result_code
    from public.abandon_owned_live_attempt(
      '10000000-0000-0000-0000-000000000001',
      'rep-one@example.invalid',
      (
        select id
        from public.live_sessions
        where lead_id = '20000000-0000-0000-0000-000000000003'
      )
    )
  ),
  'abandoned',
  'owner can abandon a starting authorization before dial'
);

-- Follow-up edits and sending remain owned by the call rep. A send is first
-- claimed as `sending`; an ambiguous provider result becomes terminal
-- `send_unknown` and cannot be retried accidentally.
insert into public.followups (
  id,
  call_id,
  kind,
  to_address,
  subject,
  body
) values (
  '50000000-0000-0000-0000-000000000001',
  (
    select id
    from public.calls
    where completion_request_id = '40000000-0000-0000-0000-000000000002'
  ),
  'sms',
  '+15555550102',
  null,
  'Original draft'
);

select is(
  (
    select result_code
    from public.update_owned_followup_draft(
      '10000000-0000-0000-0000-000000000002',
      'rep-two@example.invalid',
      '50000000-0000-0000-0000-000000000001',
      null,
      'Not allowed'
    )
  ),
  'not_owned',
  'another employee cannot edit the follow-up'
);

select is(
  (
    select result_code
    from public.update_owned_followup_draft(
      '10000000-0000-0000-0000-000000000001',
      'rep-one@example.invalid',
      '50000000-0000-0000-0000-000000000001',
      null,
      'Updated draft'
    )
  ),
  'updated',
  'call owner can edit the follow-up'
);

select is(
  (
    select result_code
    from public.begin_owned_followup_send(
      '10000000-0000-0000-0000-000000000001',
      'rep-one@example.invalid',
      '50000000-0000-0000-0000-000000000001',
      '60000000-0000-0000-0000-000000000001'
    )
  ),
  'ready',
  'call owner claims the draft before the provider send'
);

select is(
  (
    select result_code
    from public.begin_owned_followup_send(
      '10000000-0000-0000-0000-000000000001',
      'rep-one@example.invalid',
      '50000000-0000-0000-0000-000000000001',
      '60000000-0000-0000-0000-000000000001'
    )
  ),
  'in_progress',
  'same send attempt does not return provider payload twice'
);

select is(
  (
    select status
    from public.finish_owned_followup_send(
      '10000000-0000-0000-0000-000000000001',
      'rep-one@example.invalid',
      '50000000-0000-0000-0000-000000000001',
      '60000000-0000-0000-0000-000000000001',
      'unknown',
      null
    )
  ),
  'send_unknown',
  'ambiguous provider result is retained for reconciliation'
);

select is(
  (
    select result_code
    from public.begin_owned_followup_send(
      '10000000-0000-0000-0000-000000000001',
      'rep-one@example.invalid',
      '50000000-0000-0000-0000-000000000001',
      '60000000-0000-0000-0000-000000000002'
    )
  ),
  'send_unknown',
  'unknown send cannot be retried with a new token'
);

insert into public.followups (
  id,
  call_id,
  kind,
  to_address,
  subject,
  body
) values (
  '50000000-0000-0000-0000-000000000002',
  (
    select id
    from public.calls
    where completion_request_id = '40000000-0000-0000-0000-000000000002'
  ),
  'email',
  'lead@example.invalid',
  'Follow up',
  'Provider evidence test'
);

select is(
  (
    select result_code
    from public.begin_owned_followup_send(
      '10000000-0000-0000-0000-000000000001',
      'rep-one@example.invalid',
      '50000000-0000-0000-0000-000000000002',
      '60000000-0000-0000-0000-000000000002'
    )
  ),
  'ready',
  'a second owned follow-up can begin sending'
);

select is(
  (
    select status
    from public.finish_owned_followup_send(
      '10000000-0000-0000-0000-000000000001',
      'rep-one@example.invalid',
      '50000000-0000-0000-0000-000000000002',
      '60000000-0000-0000-0000-000000000002',
      'sent',
      'provider-message-one'
    )
  ),
  'approved_sent',
  'a successful send stores provider-confirmed status'
);

select is(
  (
    select result_code
    from public.finish_owned_followup_send(
      '10000000-0000-0000-0000-000000000001',
      'rep-one@example.invalid',
      '50000000-0000-0000-0000-000000000002',
      '60000000-0000-0000-0000-000000000002',
      null,
      null
    )
  ),
  'invalid_input',
  'NULL provider result fails closed'
);

select is(
  (
    select provider_message_id
    from public.followups
    where id = '50000000-0000-0000-0000-000000000002'
  ),
  'provider-message-one',
  'sent follow-up retains immutable provider evidence'
);

select is(
  (
    select result_code
    from public.finish_owned_followup_send(
      '10000000-0000-0000-0000-000000000001',
      'rep-one@example.invalid',
      '50000000-0000-0000-0000-000000000002',
      '60000000-0000-0000-0000-000000000002',
      'sent',
      'provider-message-one'
    )
  ),
  'already_finished',
  'successful finish retry is idempotent with the same provider evidence'
);

insert into public.followups (
  id,
  call_id,
  kind,
  to_address,
  subject,
  body
) values (
  '50000000-0000-0000-0000-000000000003',
  (
    select id
    from public.calls
    where completion_request_id = '40000000-0000-0000-0000-000000000004'
  ),
  'sms',
  '+15555550104',
  null,
  'Retryable provider failure test'
);

select is(
  (
    select result_code
    from public.begin_owned_followup_send(
      '10000000-0000-0000-0000-000000000001',
      'rep-one@example.invalid',
      '50000000-0000-0000-0000-000000000003',
      '60000000-0000-0000-0000-000000000003'
    )
  ),
  'ready',
  'definite-failure test send begins'
);

select is(
  (
    select status
    from public.finish_owned_followup_send(
      '10000000-0000-0000-0000-000000000001',
      'rep-one@example.invalid',
      '50000000-0000-0000-0000-000000000003',
      '60000000-0000-0000-0000-000000000003',
      'definite_failure',
      null
    )
  ),
  'draft',
  'a definite provider failure returns the follow-up to retryable draft'
);

select is(
  (
    select result_code
    from public.begin_owned_followup_send(
      '10000000-0000-0000-0000-000000000001',
      'rep-one@example.invalid',
      '50000000-0000-0000-0000-000000000003',
      '60000000-0000-0000-0000-000000000004'
    )
  ),
  'ready',
  'a definite failure can be retried under a new send attempt'
);

reset role;

insert into public.transcripts (
  id,
  raw_text,
  outcome,
  metric_scope
) values (
  '70000000-0000-0000-0000-000000000001',
  'ambiguous legacy-style transcript retained outside performance metrics',
  'unknown',
  'pending'
);

select throws_ok(
  $sql$
    update public.transcripts
    set metric_scope = 'performance'
    where id = '70000000-0000-0000-0000-000000000001'
  $sql$,
  '23514',
  'Transcript metric scope is immutable',
  'an ambiguous transcript cannot be promoted by a direct compatibility write'
);

select throws_ok(
  $sql$
    update public.calls
    set transcript_id = '70000000-0000-0000-0000-000000000001'
    where completion_request_id = '40000000-0000-0000-0000-000000000002'
  $sql$,
  '23514',
  'Call and transcript metric scopes must match',
  'a performance call cannot link a pending transcript'
);

select throws_ok(
  $sql$
    insert into public.call_scores (
      id,
      transcript_id,
      rubric_version,
      emotional,
      sales,
      hospitality,
      hard_metrics,
      experience,
      experience_score,
      overall,
      win,
      metric_scope
    ) values (
      '70000000-0000-0000-0000-000000000002',
      '70000000-0000-0000-0000-000000000001',
      1,
      '{}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      0,
      0,
      'pending fixture',
      'performance'
    )
  $sql$,
  '23514',
  'Call score and transcript metric scopes must match',
  'a score cannot claim broader provenance than its source transcript'
);

select lives_ok(
  $sql$
    insert into public.call_scores (
      id,
      transcript_id,
      rubric_version,
      emotional,
      sales,
      hospitality,
      hard_metrics,
      experience,
      experience_score,
      overall,
      win,
      metric_scope
    ) values (
      '70000000-0000-0000-0000-000000000002',
      '70000000-0000-0000-0000-000000000001',
      1,
      '{}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      0,
      0,
      'pending fixture',
      'pending'
    )
  $sql$,
  'a score with the same pending scope as its source transcript is retained but excluded'
);

select throws_ok(
  $sql$
    update public.call_scores
    set metric_scope = 'performance'
    where id = '70000000-0000-0000-0000-000000000002'
  $sql$,
  '23514',
  'Call score metric scope is immutable',
  'a pending score cannot be promoted by a direct compatibility write'
);

select throws_ok(
  $sql$
    insert into public.calls (
      id,
      direction,
      metric_scope
    ) values (
      '70000000-0000-0000-0000-000000000003',
      'outbound',
      'performance'
    )
  $sql$,
  '23514',
  'A new performance call requires a completed outcome',
  'a new call cannot enter performance scope without completion evidence'
);

select throws_ok(
  $sql$
    update public.calls
    set metric_scope = 'performance'
    where lead_id = '20000000-0000-0000-0000-000000000003'
  $sql$,
  '23514',
  'Invalid call metric scope transition',
  'an authorization abandoned before dial cannot be promoted to performance'
);

insert into public.second_mile_touches (
  id,
  kind,
  payload,
  dedupe_key
) values (
  '70000000-0000-0000-0000-000000000004',
  'personal_touch',
  jsonb_build_object(
    'transcript_id',
    '70000000-0000-0000-0000-000000000001'
  ),
  'personal_touch:pending-provenance-fixture'
);

select throws_ok(
  'select public.assert_personal_touch_metric_provenance()',
  '55000',
  'Personal-touch metric provenance is unsafe (unsafe_personal_touches=1); remove or quarantine each personal_touch row whose source transcript is not performance-scoped',
  'a personal-touch task cannot be sourced from a pending transcript'
);

delete from public.second_mile_touches
where id = '70000000-0000-0000-0000-000000000004';

select lives_ok(
  'select public.assert_personal_touch_metric_provenance()',
  'the personal-touch provenance assertion passes after unsafe rows are removed'
);

insert into public.verticals (
  id,
  slug,
  name,
  active_version
) values (
  '70000000-0000-0000-0000-000000000010',
  'legacy-metric-artifact-fixture',
  'Legacy metric artifact fixture',
  1
);

insert into public.playbook_versions (
  id,
  vertical_id,
  version,
  content,
  source
) values (
  '70000000-0000-0000-0000-000000000011',
  '70000000-0000-0000-0000-000000000010',
  1,
  '{}'::jsonb,
  'edited'
);

insert into public.playbook_proposals (
  id,
  vertical_id,
  section,
  kind,
  proposed_value,
  evidence,
  status
) values (
  '70000000-0000-0000-0000-000000000012',
  '70000000-0000-0000-0000-000000000010',
  'opening',
  'change',
  '{}'::jsonb,
  'legacy performance evidence',
  'approved'
);

insert into public.brain_reviews (
  id,
  vertical_id,
  period_start,
  period_end,
  stats,
  narrative
) values (
  '70000000-0000-0000-0000-000000000013',
  '70000000-0000-0000-0000-000000000010',
  date '2026-01-01',
  date '2026-01-07',
  '{}'::jsonb,
  'legacy review'
);

insert into public.weekly_digests (
  id,
  period_start,
  period_end,
  content
) values (
  '70000000-0000-0000-0000-000000000014',
  date '2026-01-01',
  date '2026-01-07',
  '{}'::jsonb
);

select throws_ok(
  'select public.assert_legacy_metric_artifacts_reconciled()',
  '55000',
  'Legacy metric artifacts require reconciliation before migration 0020 (weekly_digests=1, brain_reviews=1, playbook_proposals=1, edited_playbook_versions=1); export them, remove reviews/digests/proposals and edited versions, reset each affected vertical.active_version to a retained generated version, then recreate only verified manual edits after 0020',
  'legacy reports, proposals, and potentially proposal-applied versions block deployment'
);

delete from public.weekly_digests
where id = '70000000-0000-0000-0000-000000000014';

delete from public.brain_reviews
where id = '70000000-0000-0000-0000-000000000013';

delete from public.playbook_proposals
where id = '70000000-0000-0000-0000-000000000012';

delete from public.playbook_versions
where id = '70000000-0000-0000-0000-000000000011';

delete from public.verticals
where id = '70000000-0000-0000-0000-000000000010';

select lives_ok(
  'select public.assert_legacy_metric_artifacts_reconciled()',
  'deployment preflight passes only after historical metric artifacts are reconciled'
);

select throws_ok(
  $sql$
    update public.followups
    set provider_message_id = 'provider-message-changed'
    where id = '50000000-0000-0000-0000-000000000002'
  $sql$,
  '23514',
  'Follow-up provider message id is immutable',
  'provider evidence cannot be overwritten after a successful send'
);

select throws_ok(
  $sql$
    update public.live_segments
    set body = 'mutated'
    where source_segment_id = '30000000-0000-0000-0000-000000000001'
  $sql$,
  '55000',
  'Live segments are immutable',
  'even postgres cannot mutate a live segment without disabling the trigger'
);

select throws_ok(
  $sql$
    update public.live_sessions
    set status = 'starting', ended_at = null
    where lead_id = '20000000-0000-0000-0000-000000000001'
  $sql$,
  '23514',
  null,
  'terminal live-session transitions fail closed'
);

select * from finish();
rollback;
