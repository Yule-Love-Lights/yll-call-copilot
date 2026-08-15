-- Transactional authorization and lifecycle boundary for queued-lead work.
--
-- The server still uses the service-role client, but every work mutation below
-- binds the request actor to the durable app_user, lead claim, call owner, and
-- live session while holding those rows in one canonical lock order:
--
--   app_users -> leads -> calls -> live_sessions
--
-- Browser roles cannot execute these routines or access the underlying rows.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- Legacy reviews, digests, proposals, and proposal-applied playbook versions
-- were built before metric provenance existed. There is no reliable database
-- evidence that can distinguish a manual edit from a version created by an
-- approved proposal, so deployment must stop for an explicit operator audit.
-- Run the preflight before any persistent DDL so a non-transactional migration
-- runner cannot strand half of migration 0020 after this intentional failure.
do $legacy_metric_artifact_preflight$
declare
  v_weekly_digests bigint;
  v_brain_reviews bigint;
  v_playbook_proposals bigint;
  v_edited_playbook_versions bigint;
begin
  select count(*) into v_weekly_digests
  from public.weekly_digests;

  select count(*) into v_brain_reviews
  from public.brain_reviews;

  select count(*) into v_playbook_proposals
  from public.playbook_proposals;

  select count(*) into v_edited_playbook_versions
  from public.playbook_versions
  where source = 'edited';

  if v_weekly_digests > 0
    or v_brain_reviews > 0
    or v_playbook_proposals > 0
    or v_edited_playbook_versions > 0
  then
    raise exception using
      errcode = '55000',
      message = format(
        'Legacy metric artifacts require reconciliation before migration 0020 (weekly_digests=%s, brain_reviews=%s, playbook_proposals=%s, edited_playbook_versions=%s); export them, remove reviews/digests/proposals and edited versions, reset each affected vertical.active_version to a retained generated version, then recreate only verified manual edits after 0020',
        v_weekly_digests,
        v_brain_reviews,
        v_playbook_proposals,
        v_edited_playbook_versions
      );
  end if;
end
$legacy_metric_artifact_preflight$;

-- A legacy personal-touch task is derived from one transcript. Before this
-- migration those tasks did not carry metric provenance, so prove that every
-- referenced transcript will receive the positive performance classification
-- below. Missing/malformed transcript ids, ambiguous uploads, and simulator
-- transcripts stop the deploy before any persistent DDL is applied.
do $legacy_personal_touch_provenance_preflight$
declare
  v_unsafe_personal_touches bigint;
begin
  select count(*)
  into v_unsafe_personal_touches
  from public.second_mile_touches as touch_record
  left join public.transcripts as transcript_record
    on transcript_record.id::text = nullif(
      btrim(touch_record.payload ->> 'transcript_id'),
      ''
    )
  where touch_record.kind = 'personal_touch'
    and not case
      when transcript_record.id is null then false
      when exists (
        select 1
        from public.calls as linked_call
        where linked_call.transcript_id = transcript_record.id
      ) then not exists (
        select 1
        from public.calls as linked_call
        where linked_call.transcript_id = transcript_record.id
          and not (
            not exists (
              select 1
              from public.live_sessions as simulator_session
              where simulator_session.call_id = linked_call.id
                and simulator_session.mode = 'simulator'
            )
            and (
              (
                exists (
                  select 1
                  from public.live_sessions as any_real_session
                  where any_real_session.call_id = linked_call.id
                    and any_real_session.mode = 'twilio'
                )
                and exists (
                  select 1
                  from public.live_sessions as ended_real_session
                  where ended_real_session.call_id = linked_call.id
                    and ended_real_session.mode = 'twilio'
                    and ended_real_session.dial_started_at is not null
                    and coalesce(
                      ended_real_session.ended_at,
                      linked_call.ended_at
                    ) is not null
                )
                and linked_call.outcome is not null
              )
              or (
                not exists (
                  select 1
                  from public.live_sessions as any_real_session
                  where any_real_session.call_id = linked_call.id
                    and any_real_session.mode = 'twilio'
                )
                and linked_call.outcome is not null
                and linked_call.ended_at is not null
              )
            )
          )
      )
      else nullif(
        btrim(coalesce(transcript_record.source_file, '')),
        ''
      ) is not null
    end;

  if v_unsafe_personal_touches > 0 then
    raise exception using
      errcode = '55000',
      message = format(
        'Legacy personal-touch provenance requires reconciliation before migration 0020 (unsafe_personal_touches=%s); remove or quarantine each unsafe personal_touch row before retrying',
        v_unsafe_personal_touches
      );
  end if;
end
$legacy_personal_touch_provenance_preflight$;

-- Keep the same assertion available after migration so pgTAP and deployment
-- tooling can execute the fail-closed rule directly.
create function public.assert_legacy_metric_artifacts_reconciled()
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_weekly_digests bigint;
  v_brain_reviews bigint;
  v_playbook_proposals bigint;
  v_edited_playbook_versions bigint;
begin
  select count(*) into v_weekly_digests
  from public.weekly_digests;

  select count(*) into v_brain_reviews
  from public.brain_reviews;

  select count(*) into v_playbook_proposals
  from public.playbook_proposals;

  select count(*) into v_edited_playbook_versions
  from public.playbook_versions
  where source = 'edited';

  if v_weekly_digests > 0
    or v_brain_reviews > 0
    or v_playbook_proposals > 0
    or v_edited_playbook_versions > 0
  then
    raise exception using
      errcode = '55000',
      message = format(
        'Legacy metric artifacts require reconciliation before migration 0020 (weekly_digests=%s, brain_reviews=%s, playbook_proposals=%s, edited_playbook_versions=%s); export them, remove reviews/digests/proposals and edited versions, reset each affected vertical.active_version to a retained generated version, then recreate only verified manual edits after 0020',
        v_weekly_digests,
        v_brain_reviews,
        v_playbook_proposals,
        v_edited_playbook_versions
      );
  end if;
end
$function$;

create function public.is_contact_calling_time_allowed(
  p_at timestamptz,
  p_timezone text
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select coalesce(
    (
      select
        (p_at at time zone timezone_record.name)::time >= time '08:00'
        and (p_at at time zone timezone_record.name)::time < time '21:00'
      from pg_timezone_names as timezone_record
      where p_at is not null
        and timezone_record.name = nullif(btrim(p_timezone), '')
      limit 1
    ),
    false
  )
$function$;

alter table public.leads
  add column claimed_employee_id uuid;

alter table public.calls
  add column rep_employee_id uuid,
  add column metric_scope text,
  add column completion_request_id uuid;

alter table public.transcripts
  add column metric_scope text;

alter table public.call_scores
  add column metric_scope text;

alter table public.live_sessions
  add column lead_id uuid,
  add column start_request_id uuid,
  add column dial_verified_contact_id text,
  add column dial_to_number text,
  add column dial_contact_timezone text;

alter table public.followups
  add column send_attempt_id uuid,
  add column send_started_at timestamptz,
  add column provider_message_id text;

-- Backfill immutable employee links only when a normalized email maps to
-- exactly one app_user. Ambiguous or missing legacy identities remain null and
-- therefore cannot pass any new work routine.
update public.leads as lead_record
set claimed_employee_id = user_record.id
from public.app_users as user_record
where lead_record.claimed_by is not null
  and lower(btrim(user_record.email)) = lower(btrim(lead_record.claimed_by))
  and not exists (
    select 1
    from public.app_users as duplicate_user
    where duplicate_user.id <> user_record.id
      and lower(btrim(duplicate_user.email)) = lower(btrim(user_record.email))
  );

update public.calls as call_record
set rep_employee_id = user_record.id
from public.app_users as user_record
where call_record.rep_email is not null
  and lower(btrim(user_record.email)) = lower(btrim(call_record.rep_email))
  and not exists (
    select 1
    from public.app_users as duplicate_user
    where duplicate_user.id <> user_record.id
      and lower(btrim(duplicate_user.email)) = lower(btrim(user_record.email))
  );

update public.live_sessions as session_record
set lead_id = call_record.lead_id
from public.calls as call_record
where call_record.id = session_record.call_id;

-- Legacy rows predate client idempotency keys. Give each historical session a
-- distinct durable value so the post-migration key is globally unambiguous.
update public.live_sessions
set start_request_id = gen_random_uuid()
where start_request_id is null;

-- Freeze the best available destination metadata for drained legacy real
-- calls. New attempts populate these values only from a current GHL read at
-- the instant the one-time dial authorization is consumed.
update public.live_sessions as session_record
set dial_verified_contact_id = call_record.ghl_contact_id,
    dial_to_number = lead_record.phone,
    dial_contact_timezone = coalesce(
      (
        select timezone_record.name
        from pg_timezone_names as timezone_record
        where timezone_record.name = lead_record.timezone
      ),
      'America/New_York'
    )
from public.calls as call_record
left join public.leads as lead_record on lead_record.id = call_record.lead_id
where call_record.id = session_record.call_id
  and session_record.mode = 'twilio'
  and session_record.dial_started_at is not null;

-- Legacy dialed sessions must have enough durable destination evidence to
-- satisfy the new real-call state shape. If history is incomplete, stop the
-- deploy for reconciliation instead of weakening the invariant.
do $legacy_dial_evidence_preflight$
begin
  if exists (
    select 1
    from public.live_sessions
    where mode = 'twilio'
      and dial_started_at is not null
      and (
        dial_verified_contact_id is null
        or dial_to_number is null
        or dial_contact_timezone is null
      )
  ) then
    raise exception
      'A dialed legacy Twilio session lacks contact evidence; reconcile it before migration 0020';
  end if;
end
$legacy_dial_evidence_preflight$;

-- Never rewrite or terminate a real call during deploy. Operators must drain
-- legacy Twilio sessions before applying this migration.
do $migration_preflight$
begin
  if exists (
    select 1
    from public.live_sessions
    where mode = 'twilio'
      and status = 'active'
  ) then
    raise exception
      'Active legacy Twilio sessions exist; drain them before migration 0020';
  end if;

  if exists (
    select call_id
    from public.live_sessions
    where call_id is not null
    group by call_id
    having count(*) > 1
  ) then
    raise exception
      'A call has multiple live sessions; reconcile it before migration 0020';
  end if;

  if exists (
    select call_id, kind
    from public.followups
    where call_id is not null
    group by call_id, kind
    having count(*) > 1
  ) then
    raise exception
      'A call has duplicate follow-up kinds; reconcile them before migration 0020';
  end if;
end
$migration_preflight$;

-- The old two-state check and dial-shape check both name the legacy `ended`
-- value. Replace them only after the active-Twilio preflight above succeeds.
alter table public.live_sessions
  drop constraint live_sessions_status_check,
  drop constraint live_dial_grant_shape,
  alter column status drop default;

-- Legacy simulator sessions are training-only and terminal. A drained Twilio
-- session is a real performance call only when a dial was consumed and an end
-- timestamp exists. A real ended call without an outcome remains pending the
-- rep's outcome; an authorization that never became a real call is abandoned.
update public.live_sessions as session_record
set
  status = case
    when session_record.mode = 'simulator' then 'abandoned'
    when session_record.mode = 'twilio'
      and session_record.dial_started_at is not null
      and coalesce(session_record.ended_at, call_record.ended_at) is not null
      and call_record.outcome is not null
      then 'completed'
    when session_record.mode = 'twilio'
      and session_record.dial_started_at is not null
      and coalesce(session_record.ended_at, call_record.ended_at) is not null
      then 'pending_outcome'
    else 'abandoned'
  end,
  ended_at = coalesce(
    session_record.ended_at,
    call_record.ended_at,
    clock_timestamp()
  )
from public.calls as call_record
where call_record.id = session_record.call_id;

-- Orphaned legacy rows cannot be worked and are terminalized without
-- inventing a lead, employee, or call owner.
update public.live_sessions
set status = 'abandoned',
    ended_at = coalesce(ended_at, clock_timestamp())
where status in ('active', 'ended');

update public.calls as call_record
set metric_scope = case
  when exists (
    select 1
    from public.live_sessions as simulator_session
    where simulator_session.call_id = call_record.id
      and simulator_session.mode = 'simulator'
  ) then 'training'
  when exists (
    select 1
    from public.live_sessions as real_session
    where real_session.call_id = call_record.id
      and real_session.mode = 'twilio'
  ) then case
    when exists (
      select 1
      from public.live_sessions as ended_real_session
      where ended_real_session.call_id = call_record.id
        and ended_real_session.mode = 'twilio'
        and ended_real_session.status = 'completed'
    ) then 'performance'
    else 'pending'
  end
  when call_record.outcome is not null
    and call_record.ended_at is not null
    then 'performance'
  else 'pending'
end;

-- A transcript linked from calls with conflicting provenance cannot be
-- classified safely. Stop for reconciliation instead of choosing the most
-- permissive scope.
do $linked_transcript_scope_preflight$
begin
  if exists (
    select call_record.transcript_id
    from public.calls as call_record
    where call_record.transcript_id is not null
    group by call_record.transcript_id
    having count(distinct call_record.metric_scope) > 1
  ) then
    raise exception
      'A legacy transcript is linked to calls with conflicting metric scopes; reconcile it before migration 0020';
  end if;
end
$linked_transcript_scope_preflight$;

-- Linked transcripts inherit the evidence-backed call scope. An unlinked
-- upload/import has durable source-file evidence and is performance data.
-- Every other ambiguous legacy transcript is quarantined as pending.
update public.transcripts as transcript_record
set metric_scope = case
  when exists (
    select 1
    from public.calls as call_record
    where call_record.transcript_id = transcript_record.id
  ) then (
    select call_record.metric_scope
    from public.calls as call_record
    where call_record.transcript_id = transcript_record.id
    limit 1
  )
  when nullif(btrim(coalesce(transcript_record.source_file, '')), '') is not null
    then 'performance'
  else 'pending'
end;

update public.call_scores as score_record
set metric_scope = transcript_record.metric_scope
from public.transcripts as transcript_record
where transcript_record.id = score_record.transcript_id;

-- A historical score without its transcript cannot be classified safely.
-- Refuse to invent any provenance label and require repair before
-- the column becomes mandatory below.
do $metric_scope_preflight$
begin
  if exists (
    select 1
    from public.call_scores as score_record
    left join public.transcripts as transcript_record
      on transcript_record.id = score_record.transcript_id
    where transcript_record.id is null
  ) then
    raise exception
      'A call score has no source transcript; reconcile it before migration 0020';
  end if;
end
$metric_scope_preflight$;

-- Keep a post-migration assertion for deployment checks and pgTAP. The
-- nightly writer already selects only performance transcripts; this makes
-- any legacy or out-of-band personal-touch row fail closed as well.
create function public.assert_personal_touch_metric_provenance()
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_unsafe_personal_touches bigint;
begin
  select count(*)
  into v_unsafe_personal_touches
  from public.second_mile_touches as touch_record
  left join public.transcripts as transcript_record
    on transcript_record.id::text = nullif(
      btrim(touch_record.payload ->> 'transcript_id'),
      ''
    )
  where touch_record.kind = 'personal_touch'
    and transcript_record.metric_scope is distinct from 'performance';

  if v_unsafe_personal_touches > 0 then
    raise exception using
      errcode = '55000',
      message = format(
        'Personal-touch metric provenance is unsafe (unsafe_personal_touches=%s); remove or quarantine each personal_touch row whose source transcript is not performance-scoped',
        v_unsafe_personal_touches
      );
  end if;
end
$function$;

alter table public.leads
  add constraint leads_claimed_employee_id_fkey
    foreign key (claimed_employee_id)
    references public.app_users(id)
    on delete restrict
    not valid;

alter table public.calls
  add constraint calls_rep_employee_id_fkey
    foreign key (rep_employee_id)
    references public.app_users(id)
    on delete restrict
    not valid,
  add constraint calls_metric_scope_check
    check (metric_scope in ('pending', 'performance', 'training'))
    not valid;

alter table public.transcripts
  add constraint transcripts_metric_scope_check
    check (metric_scope in ('pending', 'performance', 'training'))
    not valid;

alter table public.call_scores
  add constraint call_scores_metric_scope_check
    check (metric_scope in ('pending', 'performance', 'training'))
    not valid;

alter table public.live_sessions
  add constraint live_sessions_lead_id_fkey
    foreign key (lead_id)
    references public.leads(id)
    on delete restrict
    not valid,
  add constraint live_sessions_status_check
    check (
      status in (
        'starting',
        'active',
        'pending_outcome',
        'completed',
        'abandoned'
      )
    )
    not valid,
  add constraint live_session_state_shape check (
    (
      status = 'starting'
      and mode = 'twilio'
      and call_id is not null
      and lead_id is not null
      and start_request_id is not null
      and ended_at is null
      and dial_grant_hash is not null
      and dial_actor_auth_user_id is not null
      and dial_grant_expires_at is not null
      and dial_started_at is null
      and media_stream_grant_hash is null
      and media_stream_grant_expires_at is null
      and media_stream_started_at is null
      and dial_verified_contact_id is null
      and dial_to_number is null
      and dial_contact_timezone is null
    )
    or
    (
      status = 'active'
      and mode = 'twilio'
      and call_id is not null
      and lead_id is not null
      and start_request_id is not null
      and ended_at is null
      and dial_grant_hash is not null
      and dial_actor_auth_user_id is not null
      and dial_grant_expires_at is not null
      and dial_started_at is not null
      and media_stream_grant_hash is not null
      and media_stream_grant_expires_at is not null
      and dial_verified_contact_id is not null
      and dial_to_number is not null
      and dial_contact_timezone is not null
    )
    or
    (
      status = 'pending_outcome'
      and mode = 'twilio'
      and call_id is not null
      and lead_id is not null
      and start_request_id is not null
      and ended_at is not null
      and dial_started_at is not null
    )
    or
    (
      status = 'completed'
      and mode = 'twilio'
      and call_id is not null
      and lead_id is not null
      and start_request_id is not null
      and ended_at is not null
      and dial_started_at is not null
    )
    or
    (
      status = 'abandoned'
      and start_request_id is not null
      and ended_at is not null
    )
  ) not valid;

alter table public.leads validate constraint leads_claimed_employee_id_fkey;
alter table public.calls validate constraint calls_rep_employee_id_fkey;
alter table public.calls validate constraint calls_metric_scope_check;
alter table public.transcripts validate constraint transcripts_metric_scope_check;
alter table public.call_scores validate constraint call_scores_metric_scope_check;
alter table public.live_sessions validate constraint live_sessions_lead_id_fkey;
alter table public.live_sessions validate constraint live_sessions_status_check;
alter table public.live_sessions validate constraint live_session_state_shape;

alter table public.calls alter column metric_scope set not null;
alter table public.transcripts alter column metric_scope set not null;
alter table public.call_scores alter column metric_scope set not null;

create unique index calls_completion_request_id_unique
  on public.calls (completion_request_id)
  where completion_request_id is not null;

alter table public.live_sessions
  add constraint live_sessions_call_id_unique unique (call_id);

create unique index live_sessions_one_open_attempt_per_lead
  on public.live_sessions (lead_id)
  where status in ('starting', 'active', 'pending_outcome');

create unique index live_sessions_start_request_id_unique
  on public.live_sessions (start_request_id);

alter table public.followups
  add constraint followups_call_kind_unique unique (call_id, kind);

create unique index followups_provider_message_id_unique
  on public.followups (provider_message_id)
  where provider_message_id is not null;

-- Preserve legacy sent history without inventing provider evidence. New sends
-- use the sending lifecycle below and therefore always record a real provider
-- message id; old approved rows are identifiable by all three new fields null.
update public.followups
set sent_at = coalesce(sent_at, created_at, clock_timestamp())
where status = 'approved_sent';

update public.followups
set sent_at = null
where status = 'failed';

alter table public.followups
  drop constraint followups_status_check;

alter table public.followups
  add constraint followups_status_check check (
    status in (
      'draft',
      'sending',
      'send_unknown',
      'approved_sent',
      'failed'
    )
  ),
  add constraint followups_send_shape check (
    (
      status = 'draft'
      and send_attempt_id is null
      and send_started_at is null
      and sent_at is null
    )
    or
    (
      status in ('sending', 'send_unknown')
      and send_attempt_id is not null
      and send_started_at is not null
      and sent_at is null
    )
    or (
      status = 'approved_sent'
      and sent_at is not null
      and (
        (
          send_attempt_id is null
          and send_started_at is null
          and provider_message_id is null
        )
        or (
          send_attempt_id is not null
          and send_started_at is not null
          and provider_message_id is not null
        )
      )
    )
    or (
      status = 'failed'
      and sent_at is null
      and provider_message_id is null
    )
  );

create table public.live_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_sessions(id) on delete restrict,
  source_segment_id uuid not null,
  ordinal bigint not null check (ordinal > 0),
  speaker text not null check (speaker in ('rep', 'customer')),
  body text not null check (length(btrim(body)) > 0),
  at_ms integer not null check (at_ms >= 0),
  silence_ms integer check (silence_ms is null or silence_ms >= 0),
  created_at timestamptz not null default now(),
  unique (session_id, source_segment_id),
  unique (session_id, ordinal)
);

alter table public.coaching_events
  add column live_segment_id uuid references public.live_segments(id)
    on delete restrict;

create unique index coaching_events_live_segment_id_unique
  on public.coaching_events (live_segment_id)
  where live_segment_id is not null;

alter table public.live_segments enable row level security;
alter table public.live_segments force row level security;

revoke all privileges on table public.live_segments
  from public, anon, authenticated, service_role;
grant select, insert on table public.live_segments to service_role;

-- Metric provenance is a relational invariant, not a label each writer may
-- choose independently. Calls may move only from pending authorization to a
-- verified performance call. Linked transcripts and scores must have the same
-- scope as their source row, and transcript/score provenance is immutable.
create function public.enforce_call_metric_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_transcript_scope text;
begin
  if tg_op = 'INSERT'
    and new.metric_scope = 'performance'
    and (new.outcome is null or new.ended_at is null)
  then
    raise exception 'A new performance call requires a completed outcome'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE'
    and new.metric_scope is distinct from old.metric_scope
    and not (
      old.metric_scope = 'pending'
      and new.metric_scope = 'performance'
      and new.ended_at is not null
      and exists (
        select 1
        from public.live_sessions as session_record
        where session_record.call_id = new.id
          and session_record.mode = 'twilio'
          and session_record.dial_started_at is not null
      )
    )
  then
    raise exception 'Invalid call metric scope transition'
      using errcode = '23514';
  end if;

  if new.transcript_id is not null then
    select transcript_record.metric_scope
    into v_transcript_scope
    from public.transcripts as transcript_record
    where transcript_record.id = new.transcript_id;

    if not found or v_transcript_scope is distinct from new.metric_scope then
      raise exception 'Call and transcript metric scopes must match'
        using errcode = '23514';
    end if;
  end if;

  return new;
end
$function$;

create trigger enforce_call_metric_scope
before insert or update on public.calls
for each row execute function public.enforce_call_metric_scope();

create function public.enforce_transcript_metric_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.metric_scope is distinct from old.metric_scope then
    raise exception 'Transcript metric scope is immutable'
      using errcode = '23514';
  end if;

  return new;
end
$function$;

create trigger enforce_transcript_metric_scope
before update on public.transcripts
for each row execute function public.enforce_transcript_metric_scope();

create function public.enforce_call_score_metric_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_transcript_scope text;
begin
  if tg_op = 'UPDATE'
    and new.metric_scope is distinct from old.metric_scope
  then
    raise exception 'Call score metric scope is immutable'
      using errcode = '23514';
  end if;

  select transcript_record.metric_scope
  into v_transcript_scope
  from public.transcripts as transcript_record
  where transcript_record.id = new.transcript_id;

  if not found or v_transcript_scope is distinct from new.metric_scope then
    raise exception 'Call score and transcript metric scopes must match'
      using errcode = '23514';
  end if;

  return new;
end
$function$;

create trigger enforce_call_score_metric_scope
before insert or update on public.call_scores
for each row execute function public.enforce_call_score_metric_scope();

-- Terminal states and ownership/link fields are immutable. State changes must
-- follow the positive lifecycle even if a future server route accidentally
-- issues direct compatibility DML.
create function public.enforce_live_session_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'Live sessions cannot be deleted'
      using errcode = '55000';
  end if;

  if new.id is distinct from old.id
    or new.call_id is distinct from old.call_id
    or new.lead_id is distinct from old.lead_id
    or new.start_request_id is distinct from old.start_request_id
    or new.mode is distinct from old.mode
    or new.started_at is distinct from old.started_at
    or (
      old.status <> 'starting'
      and (
        new.dial_verified_contact_id is distinct from old.dial_verified_contact_id
        or new.dial_to_number is distinct from old.dial_to_number
        or new.dial_contact_timezone is distinct from old.dial_contact_timezone
      )
    )
  then
    raise exception 'Live session identity fields are immutable'
      using errcode = '23514';
  end if;

  if new.status is not distinct from old.status
    and (
      new.dial_grant_hash is distinct from old.dial_grant_hash
      or new.dial_actor_auth_user_id is distinct from old.dial_actor_auth_user_id
      or new.dial_grant_expires_at is distinct from old.dial_grant_expires_at
      or new.dial_started_at is distinct from old.dial_started_at
      or new.media_stream_grant_hash is distinct from old.media_stream_grant_hash
      or new.media_stream_grant_expires_at is distinct from old.media_stream_grant_expires_at
      or new.media_stream_started_at is distinct from old.media_stream_started_at
      or new.ended_at is distinct from old.ended_at
    )
  then
    -- The only same-state lifecycle mutation is first stream consumption.
    -- Every other lifecycle field moves with a positive state transition.
    if not (
      old.status = 'active'
      and old.media_stream_started_at is null
      and new.media_stream_started_at is not null
      and new.dial_grant_hash is not distinct from old.dial_grant_hash
      and new.dial_actor_auth_user_id is not distinct from old.dial_actor_auth_user_id
      and new.dial_grant_expires_at is not distinct from old.dial_grant_expires_at
      and new.dial_started_at is not distinct from old.dial_started_at
      and new.media_stream_grant_hash is not distinct from old.media_stream_grant_hash
      and new.media_stream_grant_expires_at is not distinct from old.media_stream_grant_expires_at
      and new.ended_at is not distinct from old.ended_at
    ) then
      raise exception 'Live session lifecycle fields require a state transition'
        using errcode = '23514';
    end if;
  end if;

  if new.transcript_running is distinct from old.transcript_running
    and not (
      old.status = 'active'
      and new.status = 'active'
    )
  then
    raise exception 'Live session transcript is immutable outside active capture'
      using errcode = '23514';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'starting' and new.status = 'active' then
      if new.dial_grant_hash is distinct from old.dial_grant_hash
        or new.dial_actor_auth_user_id is distinct from old.dial_actor_auth_user_id
        or new.dial_grant_expires_at is distinct from old.dial_grant_expires_at
        or old.dial_started_at is not null
        or new.dial_started_at is null
        or old.media_stream_grant_hash is not null
        or new.media_stream_grant_hash is null
        or old.media_stream_grant_expires_at is not null
        or new.media_stream_grant_expires_at is null
        or new.media_stream_started_at is not null
        or old.dial_verified_contact_id is not null
        or new.dial_verified_contact_id is null
        or old.dial_to_number is not null
        or new.dial_to_number is null
        or old.dial_contact_timezone is not null
        or new.dial_contact_timezone is null
        or new.ended_at is distinct from old.ended_at
      then
        raise exception 'Invalid starting -> active field transition'
          using errcode = '23514';
      end if;
    elsif old.status = 'starting' and new.status = 'abandoned' then
      if new.dial_grant_hash is distinct from old.dial_grant_hash
        or new.dial_actor_auth_user_id is distinct from old.dial_actor_auth_user_id
        or new.dial_grant_expires_at is distinct from old.dial_grant_expires_at
        or new.dial_started_at is distinct from old.dial_started_at
        or new.media_stream_grant_hash is distinct from old.media_stream_grant_hash
        or new.media_stream_grant_expires_at is distinct from old.media_stream_grant_expires_at
        or new.media_stream_started_at is distinct from old.media_stream_started_at
        or new.dial_verified_contact_id is distinct from old.dial_verified_contact_id
        or new.dial_to_number is distinct from old.dial_to_number
        or new.dial_contact_timezone is distinct from old.dial_contact_timezone
        or old.ended_at is not null
        or new.ended_at is null
      then
        raise exception 'Invalid starting -> abandoned field transition'
          using errcode = '23514';
      end if;
    elsif old.status = 'active' and new.status = 'pending_outcome' then
      if new.dial_grant_hash is distinct from old.dial_grant_hash
        or new.dial_actor_auth_user_id is distinct from old.dial_actor_auth_user_id
        or new.dial_grant_expires_at is distinct from old.dial_grant_expires_at
        or new.dial_started_at is distinct from old.dial_started_at
        or new.media_stream_grant_hash is distinct from old.media_stream_grant_hash
        or new.media_stream_grant_expires_at is distinct from old.media_stream_grant_expires_at
        or new.media_stream_started_at is distinct from old.media_stream_started_at
        or new.dial_verified_contact_id is distinct from old.dial_verified_contact_id
        or new.dial_to_number is distinct from old.dial_to_number
        or new.dial_contact_timezone is distinct from old.dial_contact_timezone
        or old.ended_at is not null
        or new.ended_at is null
      then
        raise exception 'Invalid active -> pending_outcome field transition'
          using errcode = '23514';
      end if;
    elsif old.status = 'pending_outcome' and new.status = 'completed' then
      if new.dial_grant_hash is distinct from old.dial_grant_hash
        or new.dial_actor_auth_user_id is distinct from old.dial_actor_auth_user_id
        or new.dial_grant_expires_at is distinct from old.dial_grant_expires_at
        or new.dial_started_at is distinct from old.dial_started_at
        or new.media_stream_grant_hash is distinct from old.media_stream_grant_hash
        or new.media_stream_grant_expires_at is distinct from old.media_stream_grant_expires_at
        or new.media_stream_started_at is distinct from old.media_stream_started_at
        or new.dial_verified_contact_id is distinct from old.dial_verified_contact_id
        or new.dial_to_number is distinct from old.dial_to_number
        or new.dial_contact_timezone is distinct from old.dial_contact_timezone
        or new.ended_at is distinct from old.ended_at
      then
        raise exception 'Invalid pending_outcome -> completed field transition'
          using errcode = '23514';
      end if;
    else
      raise exception 'Invalid live session transition: % -> %',
        old.status,
        new.status
        using errcode = '23514';
    end if;
  end if;

  return new;
end
$function$;

create trigger enforce_live_session_transition
before update or delete on public.live_sessions
for each row execute function public.enforce_live_session_transition();

create function public.enforce_followup_provider_message_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.provider_message_id is distinct from old.provider_message_id
    and not (
      old.provider_message_id is null
      and new.provider_message_id is not null
      and old.status = 'sending'
      and new.status = 'approved_sent'
      and new.sent_at is not null
    )
  then
    raise exception 'Follow-up provider message id is immutable'
      using errcode = '23514';
  end if;

  return new;
end
$function$;

create trigger enforce_followup_provider_message_immutable
before update on public.followups
for each row execute function public.enforce_followup_provider_message_immutable();

create function public.reject_live_segment_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception 'Live segments are immutable'
    using errcode = '55000';
end
$function$;

create trigger reject_live_segment_mutation
before update or delete on public.live_segments
for each row execute function public.reject_live_segment_mutation();

create function public.decide_queued_lead(
  p_actor_employee_id uuid,
  p_actor_auth_user_id text,
  p_actor_email text,
  p_lead_id uuid,
  p_action text,
  p_verified_contact_id text,
  p_call_permission_verified boolean,
  p_verified_timezone text
)
returns table(result_code text)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_actor public.app_users%rowtype;
  v_lead public.leads%rowtype;
  v_contact_timezone text;
begin
  if p_actor_employee_id is null
    or nullif(btrim(p_actor_auth_user_id), '') is null
    or nullif(btrim(p_actor_email), '') is null
    or p_lead_id is null
    or p_action is null
    or p_action in ('claim', 'dismiss') is not true
  then
    return query select 'invalid_input'::text;
    return;
  end if;

  select actor_record.*
  into v_actor
  from public.app_users as actor_record
  where actor_record.id = p_actor_employee_id
  for update;

  if not found
    or lower(btrim(v_actor.email)) <> lower(btrim(p_actor_email))
    or v_actor.role not in ('rep', 'office', 'owner', 'admin')
  then
    return query select 'actor_inactive'::text;
    return;
  end if;

  select lead_record.*
  into v_lead
  from public.leads as lead_record
  where lead_record.id = p_lead_id
  for update;

  if not found then
    return query select 'not_queued'::text;
    return;
  end if;

  if p_action = 'claim' then
    if v_lead.status <> 'queued'
      or v_lead.claimed_by is not null
      or v_lead.claimed_employee_id is not null
    then
      return query select 'not_queued'::text;
      return;
    end if;

    if p_call_permission_verified is not true
      or nullif(btrim(p_verified_contact_id), '') is null
      or v_lead.ghl_contact_id is distinct from btrim(p_verified_contact_id)
    then
      return query select 'claim_not_authorized'::text;
      return;
    end if;

    select coalesce(
      (
        select timezone_record.name
        from pg_timezone_names as timezone_record
        where timezone_record.name = nullif(btrim(p_verified_timezone), '')
        limit 1
      ),
      (
        select timezone_record.name
        from pg_timezone_names as timezone_record
        where timezone_record.name = nullif(btrim(v_lead.timezone), '')
        limit 1
      ),
      'America/New_York'
    )
    into v_contact_timezone;

    if public.is_contact_calling_time_allowed(
      clock_timestamp(),
      v_contact_timezone
    ) is not true
    then
      return query select 'outside_calling_hours'::text;
      return;
    end if;

    update public.leads
    set status = 'claimed',
        claimed_by = lower(btrim(v_actor.email)),
        claimed_employee_id = v_actor.id,
        timezone = v_contact_timezone
    where id = v_lead.id;
  else
    if v_lead.status = 'claimed'
      and (
        v_lead.claimed_employee_id is distinct from v_actor.id
        or lower(btrim(coalesce(v_lead.claimed_by, ''))) <>
          lower(btrim(v_actor.email))
      )
    then
      return query select 'not_owned'::text;
      return;
    end if;

    if not (
      (
        v_lead.status = 'queued'
        and v_lead.claimed_by is null
        and v_lead.claimed_employee_id is null
      )
      or (
        v_lead.status = 'claimed'
        and v_lead.claimed_employee_id is not distinct from v_actor.id
        and lower(btrim(coalesce(v_lead.claimed_by, ''))) =
          lower(btrim(v_actor.email))
      )
    )
    then
      return query select 'not_queued'::text;
      return;
    end if;

    update public.leads
    set status = 'dismissed',
        claimed_by = null,
        claimed_employee_id = null
    where id = v_lead.id;
  end if;

  insert into public.events_log (kind, detail)
  values (
    'lead_queue_decision',
    jsonb_build_object(
      'actingEmployeeId', v_actor.id,
      'actingAuthUserId', btrim(p_actor_auth_user_id),
      'leadId', v_lead.id,
      'action', p_action,
      'contactTimezone', case
        when p_action = 'claim' then v_contact_timezone
        else null
      end
    )
  );

  return query select case p_action
    when 'claim' then 'claimed'::text
    else 'dismissed'::text
  end;
end
$function$;

create function public.start_claimed_live_attempt(
  p_actor_employee_id uuid,
  p_actor_auth_user_id text,
  p_actor_email text,
  p_lead_id uuid,
  p_dial_grant_hash text,
  p_start_request_id uuid
)
returns table(result_code text, call_id uuid, session_id uuid)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz;
  v_actor public.app_users%rowtype;
  v_lead public.leads%rowtype;
  v_open_call public.calls%rowtype;
  v_open_session public.live_sessions%rowtype;
  v_open_call_id uuid;
  v_open_session_id uuid;
  v_call_id uuid := gen_random_uuid();
  v_session_id uuid := gen_random_uuid();
begin
  if p_actor_employee_id is null
    or nullif(btrim(p_actor_auth_user_id), '') is null
    or nullif(btrim(p_actor_email), '') is null
    or p_lead_id is null
    or nullif(btrim(p_dial_grant_hash), '') is null
    or p_start_request_id is null
  then
    return query select 'invalid_input'::text, null::uuid, null::uuid;
    return;
  end if;

  select actor_record.*
  into v_actor
  from public.app_users as actor_record
  where actor_record.id = p_actor_employee_id
  for update;

  if not found
    or lower(btrim(v_actor.email)) <> lower(btrim(p_actor_email))
    or v_actor.role not in ('rep', 'office', 'owner', 'admin')
  then
    return query select 'actor_inactive'::text, null::uuid, null::uuid;
    return;
  end if;

  select lead_record.*
  into v_lead
  from public.leads as lead_record
  where lead_record.id = p_lead_id
  for update;

  if not found then
    return query select 'lead_missing'::text, null::uuid, null::uuid;
    return;
  end if;

  if v_lead.status <> 'claimed'
    or v_lead.claimed_employee_id is distinct from v_actor.id
    or lower(btrim(coalesce(v_lead.claimed_by, ''))) <> lower(btrim(v_actor.email))
  then
    return query select 'not_claimed_by_actor'::text, null::uuid, null::uuid;
    return;
  end if;

  select open_session.id, open_session.call_id
  into v_open_session_id, v_open_call_id
  from public.live_sessions as open_session
  where open_session.lead_id = v_lead.id
    and open_session.status in ('starting', 'active', 'pending_outcome');

  if found then
    select call_record.* into v_open_call
    from public.calls as call_record
    where call_record.id = v_open_call_id
    for update;

    select session_record.* into v_open_session
    from public.live_sessions as session_record
    where session_record.id = v_open_session_id
    for update;

    if v_open_call.id is null
      or v_open_session.id is null
      or v_open_call.lead_id is distinct from v_lead.id
      or v_open_call.rep_employee_id is distinct from v_actor.id
      or lower(btrim(coalesce(v_open_call.rep_email, ''))) <>
        lower(btrim(v_actor.email))
      or v_open_session.call_id is distinct from v_open_call.id
      or v_open_session.lead_id is distinct from v_lead.id
      or v_open_session.mode <> 'twilio'
    then
      return query select
        'open_attempt_conflict'::text,
        null::uuid,
        null::uuid;
      return;
    end if;

    if v_open_session.start_request_id is distinct from p_start_request_id
      or v_open_session.dial_grant_hash is distinct from btrim(p_dial_grant_hash)
      or v_open_session.dial_actor_auth_user_id is distinct from
        btrim(p_actor_auth_user_id)
    then
      return query select
        'start_conflict'::text,
        v_open_call.id,
        v_open_session.id;
      return;
    end if;

    return query select
      v_open_session.status,
      v_open_call.id,
      v_open_session.id;
    return;
  end if;

  v_now := clock_timestamp();

  insert into public.calls (
    id,
    lead_id,
    ghl_contact_id,
    rep_email,
    rep_employee_id,
    direction,
    metric_scope,
    started_at
  ) values (
    v_call_id,
    v_lead.id,
    v_lead.ghl_contact_id,
    lower(btrim(v_actor.email)),
    v_actor.id,
    'outbound',
    'pending',
    v_now
  );

  insert into public.live_sessions (
    id,
    call_id,
    lead_id,
    mode,
    status,
    transcript_running,
    start_request_id,
    dial_grant_hash,
    dial_actor_auth_user_id,
    dial_grant_expires_at,
    started_at
  ) values (
    v_session_id,
    v_call_id,
    v_lead.id,
    'twilio',
    'starting',
    '',
    p_start_request_id,
    btrim(p_dial_grant_hash),
    btrim(p_actor_auth_user_id),
    v_now + interval '5 minutes',
    v_now
  );

  insert into public.events_log (kind, detail)
  values (
    'live_attempt_started',
    jsonb_build_object(
      'actingEmployeeId', v_actor.id,
      'actingAuthUserId', btrim(p_actor_auth_user_id),
      'leadId', v_lead.id,
      'callId', v_call_id,
      'sessionId', v_session_id
    )
  );

  return query select 'starting'::text, v_call_id, v_session_id;
end
$function$;

create function public.consume_authorized_live_dial(
  p_dial_grant_hash text,
  p_actor_auth_user_id text,
  p_media_stream_grant_hash text,
  p_verified_contact_id text,
  p_verified_to_number text,
  p_verified_timezone text
)
returns table(
  result_code text,
  session_id uuid,
  call_id uuid,
  lead_id uuid,
  to_number text,
  contact_timezone text
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz;
  v_actor_id uuid;
  v_lead_id uuid;
  v_call_id uuid;
  v_session_id uuid;
  v_actor public.app_users%rowtype;
  v_lead public.leads%rowtype;
  v_call public.calls%rowtype;
  v_session public.live_sessions%rowtype;
  v_contact_timezone text;
  v_verified_timezone text;
  v_local_time time without time zone;
begin
  if nullif(btrim(p_dial_grant_hash), '') is null
    or nullif(btrim(p_actor_auth_user_id), '') is null
    or nullif(btrim(p_media_stream_grant_hash), '') is null
    or nullif(btrim(p_verified_contact_id), '') is null
    or nullif(btrim(p_verified_to_number), '') is null
  then
    return query select
      'invalid_input'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text,
      null::text;
    return;
  end if;

  -- This first read only discovers the lock keys. Every relationship and
  -- grant is revalidated after the canonical locks are held.
  select
    session_record.id,
    session_record.call_id,
    session_record.lead_id,
    call_record.rep_employee_id
  into v_session_id, v_call_id, v_lead_id, v_actor_id
  from public.live_sessions as session_record
  join public.calls as call_record on call_record.id = session_record.call_id
  where session_record.dial_grant_hash = btrim(p_dial_grant_hash);

  if not found or v_actor_id is null or v_lead_id is null then
    return query select
      'invalid_or_expired'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text,
      null::text;
    return;
  end if;

  select actor_record.*
  into v_actor
  from public.app_users as actor_record
  where actor_record.id = v_actor_id
  for update;

  if not found or v_actor.role not in ('rep', 'office', 'owner', 'admin') then
    return query select
      'actor_inactive'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text,
      null::text;
    return;
  end if;

  select lead_record.*
  into v_lead
  from public.leads as lead_record
  where lead_record.id = v_lead_id
  for update;

  select call_record.*
  into v_call
  from public.calls as call_record
  where call_record.id = v_call_id
  for update;

  select session_record.*
  into v_session
  from public.live_sessions as session_record
  where session_record.id = v_session_id
  for update;

  if v_lead.id is null
    or v_call.id is null
    or v_session.id is null
    or v_call.lead_id is distinct from v_lead.id
    or v_call.rep_employee_id is distinct from v_actor.id
    or lower(btrim(coalesce(v_call.rep_email, ''))) <> lower(btrim(v_actor.email))
    or v_session.call_id is distinct from v_call.id
    or v_session.lead_id is distinct from v_lead.id
    or v_lead.status <> 'claimed'
    or v_lead.claimed_employee_id is distinct from v_actor.id
    or lower(btrim(coalesce(v_lead.claimed_by, ''))) <> lower(btrim(v_actor.email))
  then
    return query select
      'claim_lost'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text,
      null::text;
    return;
  end if;

  if v_lead.ghl_contact_id is distinct from btrim(p_verified_contact_id)
    or v_call.ghl_contact_id is distinct from btrim(p_verified_contact_id)
  then
    return query select
      'contact_binding_mismatch'::text,
      v_session.id,
      v_call.id,
      v_lead.id,
      null::text,
      null::text;
    return;
  end if;

  v_verified_timezone := nullif(btrim(coalesce(p_verified_timezone, '')), '');
  v_contact_timezone := coalesce(
    v_verified_timezone,
    'America/New_York'
  );

  -- Validate the GHL-provided zone before it is used or frozen. Invalid and
  -- missing values fall back to the company zone without trusting the stale
  -- cached lead timezone.
  begin
    perform timezone(v_contact_timezone, timestamp '2000-01-01 00:00:00');
  exception
    when invalid_parameter_value then
      v_contact_timezone := 'America/New_York';
  end;

  v_now := clock_timestamp();
  v_local_time := (v_now at time zone v_contact_timezone)::time;

  -- A consumed grant is recoverable only with the exact actor, media grant,
  -- and current GHL contact snapshot. The originally frozen destination is
  -- returned, so a lost TwiML response can never create a second dial or
  -- silently switch phone numbers.
  if v_session.mode = 'twilio'
    and v_session.status = 'active'
    and v_session.dial_started_at is not null
  then
    if v_session.dial_grant_hash = btrim(p_dial_grant_hash)
      and v_session.dial_actor_auth_user_id = btrim(p_actor_auth_user_id)
      and v_session.media_stream_grant_hash = btrim(p_media_stream_grant_hash)
      and v_session.dial_verified_contact_id = btrim(p_verified_contact_id)
      and v_session.dial_to_number = btrim(p_verified_to_number)
      and v_session.dial_contact_timezone = v_contact_timezone
    then
      if v_session.dial_grant_expires_at is null
        or v_session.dial_grant_expires_at <= v_now
        or v_local_time < time '08:00'
        or v_local_time >= time '21:00'
      then
        return query select
          'retry_window_closed'::text,
          v_session.id,
          v_call.id,
          v_lead.id,
          null::text,
          v_session.dial_contact_timezone;
        return;
      end if;

      return query select
        'already_authorized'::text,
        v_session.id,
        v_call.id,
        v_lead.id,
        v_session.dial_to_number,
        v_session.dial_contact_timezone;
      return;
    end if;

    return query select
      'replay_rejected'::text,
      v_session.id,
      v_call.id,
      v_lead.id,
      null::text,
      null::text;
    return;
  end if;

  if v_session.mode <> 'twilio'
    or v_session.status <> 'starting'
    or v_session.dial_grant_hash <> btrim(p_dial_grant_hash)
    or v_session.dial_actor_auth_user_id <> btrim(p_actor_auth_user_id)
    or v_session.dial_grant_expires_at is null
    or v_session.dial_grant_expires_at <= v_now
    or v_session.dial_started_at is not null
  then
    return query select
      'invalid_or_expired'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text,
      null::text;
    return;
  end if;

  if v_local_time < time '08:00' or v_local_time >= time '21:00' then
    return query select
      'outside_calling_hours'::text,
      v_session.id,
      v_call.id,
      v_lead.id,
      null::text,
      v_contact_timezone;
    return;
  end if;

  update public.live_sessions
  set status = 'active',
      dial_started_at = v_now,
      media_stream_grant_hash = btrim(p_media_stream_grant_hash),
      media_stream_grant_expires_at = v_now + interval '5 minutes',
      media_stream_started_at = null,
      dial_verified_contact_id = btrim(p_verified_contact_id),
      dial_to_number = btrim(p_verified_to_number),
      dial_contact_timezone = v_contact_timezone
  where id = v_session.id;

  update public.calls
  set ghl_contact_id = btrim(p_verified_contact_id),
      direction = 'outbound',
      started_at = v_now
  where id = v_call.id;

  update public.leads
  set phone = btrim(p_verified_to_number),
      timezone = v_contact_timezone
  where id = v_lead.id;

  return query select
    'authorized'::text,
    v_session.id,
    v_call.id,
    v_lead.id,
    btrim(p_verified_to_number),
    v_contact_timezone;
end
$function$;

create function public.consume_authorized_live_stream(
  p_session_id uuid,
  p_media_stream_grant_hash text
)
returns table(result_code text, session_id uuid)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz;
  v_actor_id uuid;
  v_lead_id uuid;
  v_call_id uuid;
  v_actor public.app_users%rowtype;
  v_lead public.leads%rowtype;
  v_call public.calls%rowtype;
  v_session public.live_sessions%rowtype;
begin
  if p_session_id is null
    or nullif(btrim(p_media_stream_grant_hash), '') is null
  then
    return query select 'invalid_input'::text, null::uuid;
    return;
  end if;

  select
    session_record.call_id,
    session_record.lead_id,
    call_record.rep_employee_id
  into v_call_id, v_lead_id, v_actor_id
  from public.live_sessions as session_record
  join public.calls as call_record on call_record.id = session_record.call_id
  where session_record.id = p_session_id;

  if not found or v_actor_id is null or v_lead_id is null then
    return query select 'invalid_or_used'::text, null::uuid;
    return;
  end if;

  select actor_record.*
  into v_actor
  from public.app_users as actor_record
  where actor_record.id = v_actor_id
  for update;

  if not found or v_actor.role not in ('rep', 'office', 'owner', 'admin') then
    return query select 'actor_inactive'::text, null::uuid;
    return;
  end if;

  select lead_record.* into v_lead
  from public.leads as lead_record
  where lead_record.id = v_lead_id
  for update;

  select call_record.* into v_call
  from public.calls as call_record
  where call_record.id = v_call_id
  for update;

  select session_record.* into v_session
  from public.live_sessions as session_record
  where session_record.id = p_session_id
  for update;

  if v_lead.id is null
    or v_call.id is null
    or v_session.id is null
    or v_call.lead_id is distinct from v_lead.id
    or v_call.rep_employee_id is distinct from v_actor.id
    or v_session.call_id is distinct from v_call.id
    or v_session.lead_id is distinct from v_lead.id
    or v_lead.status <> 'claimed'
    or v_lead.claimed_employee_id is distinct from v_actor.id
    or lower(btrim(coalesce(v_lead.claimed_by, ''))) <> lower(btrim(v_actor.email))
    or lower(btrim(coalesce(v_call.rep_email, ''))) <> lower(btrim(v_actor.email))
  then
    return query select 'claim_lost'::text, null::uuid;
    return;
  end if;

  if v_session.mode <> 'twilio'
    or v_session.status <> 'active'
  then
    return query select 'invalid_or_used'::text, null::uuid;
    return;
  end if;

  if v_session.media_stream_grant_hash is distinct from
    btrim(p_media_stream_grant_hash)
  then
    return query select 'replay_rejected'::text, v_session.id;
    return;
  end if;

  if v_session.media_stream_started_at is not null then
    return query select 'already_authorized'::text, v_session.id;
    return;
  end if;

  v_now := clock_timestamp();

  if v_session.media_stream_grant_expires_at is null
    or v_session.media_stream_grant_expires_at <= v_now
  then
    return query select 'invalid_or_used'::text, null::uuid;
    return;
  end if;

  update public.live_sessions
  set media_stream_started_at = v_now
  where id = v_session.id;

  return query select 'authorized'::text, v_session.id;
end
$function$;

create function public.append_authorized_live_segment(
  p_session_id uuid,
  p_source_segment_id uuid,
  p_speaker text,
  p_body text,
  p_at_ms integer,
  p_silence_ms integer
)
returns table(
  result_code text,
  segment_id uuid,
  call_id uuid,
  ordinal bigint,
  at_ms integer,
  transcript_running text,
  inserted boolean
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz;
  v_actor_id uuid;
  v_lead_id uuid;
  v_call_id uuid;
  v_actor public.app_users%rowtype;
  v_lead public.leads%rowtype;
  v_call public.calls%rowtype;
  v_session public.live_sessions%rowtype;
  v_existing public.live_segments%rowtype;
  v_segment_id uuid := gen_random_uuid();
  v_ordinal bigint;
  v_line text;
  v_transcript text;
begin
  if p_session_id is null
    or p_source_segment_id is null
    or p_speaker is null
    or p_speaker in ('rep', 'customer') is not true
    or nullif(btrim(p_body), '') is null
    or p_at_ms is null
    or p_at_ms < 0
    or (p_silence_ms is not null and p_silence_ms < 0)
  then
    return query select
      'invalid_input'::text,
      null::uuid,
      null::uuid,
      null::bigint,
      null::integer,
      null::text,
      false;
    return;
  end if;

  select
    session_record.call_id,
    session_record.lead_id,
    call_record.rep_employee_id
  into v_call_id, v_lead_id, v_actor_id
  from public.live_sessions as session_record
  join public.calls as call_record on call_record.id = session_record.call_id
  where session_record.id = p_session_id;

  if not found or v_actor_id is null or v_lead_id is null then
    return query select
      'not_authorized'::text,
      null::uuid,
      null::uuid,
      null::bigint,
      null::integer,
      null::text,
      false;
    return;
  end if;

  select actor_record.* into v_actor
  from public.app_users as actor_record
  where actor_record.id = v_actor_id
  for update;

  if not found or v_actor.role not in ('rep', 'office', 'owner', 'admin') then
    return query select
      'actor_inactive'::text,
      null::uuid,
      null::uuid,
      null::bigint,
      null::integer,
      null::text,
      false;
    return;
  end if;

  select lead_record.* into v_lead
  from public.leads as lead_record
  where lead_record.id = v_lead_id
  for update;

  select call_record.* into v_call
  from public.calls as call_record
  where call_record.id = v_call_id
  for update;

  select session_record.* into v_session
  from public.live_sessions as session_record
  where session_record.id = p_session_id
  for update;

  if v_lead.id is null
    or v_call.id is null
    or v_session.id is null
    or v_call.lead_id is distinct from v_lead.id
    or v_call.rep_employee_id is distinct from v_actor.id
    or v_session.call_id is distinct from v_call.id
    or v_session.lead_id is distinct from v_lead.id
    or v_lead.status <> 'claimed'
    or v_lead.claimed_employee_id is distinct from v_actor.id
    or lower(btrim(coalesce(v_lead.claimed_by, ''))) <> lower(btrim(v_actor.email))
    or lower(btrim(coalesce(v_call.rep_email, ''))) <> lower(btrim(v_actor.email))
    or v_session.mode <> 'twilio'
    or v_session.status <> 'active'
    or v_session.media_stream_started_at is null
  then
    return query select
      'not_authorized'::text,
      null::uuid,
      null::uuid,
      null::bigint,
      null::integer,
      null::text,
      false;
    return;
  end if;

  select segment_record.*
  into v_existing
  from public.live_segments as segment_record
  where segment_record.session_id = v_session.id
    and segment_record.source_segment_id = p_source_segment_id;

  if found then
    if v_existing.speaker is distinct from p_speaker
      or v_existing.body is distinct from btrim(p_body)
      or v_existing.at_ms is distinct from p_at_ms
      or v_existing.silence_ms is distinct from p_silence_ms
    then
      return query select
        'segment_conflict'::text,
        v_existing.id,
        v_call.id,
        v_existing.ordinal,
        v_existing.at_ms,
        v_session.transcript_running,
        false;
      return;
    end if;

    return query select
      'already_saved'::text,
      v_existing.id,
      v_call.id,
      v_existing.ordinal,
      v_existing.at_ms,
      v_session.transcript_running,
      false;
    return;
  end if;

  select coalesce(max(segment_record.ordinal), 0) + 1
  into v_ordinal
  from public.live_segments as segment_record
  where segment_record.session_id = v_session.id;

  v_now := clock_timestamp();

  insert into public.live_segments (
    id,
    session_id,
    source_segment_id,
    ordinal,
    speaker,
    body,
    at_ms,
    silence_ms,
    created_at
  ) values (
    v_segment_id,
    v_session.id,
    p_source_segment_id,
    v_ordinal,
    p_speaker,
    btrim(p_body),
    p_at_ms,
    p_silence_ms,
    v_now
  );

  v_line := p_speaker || ': ' || btrim(p_body);
  v_transcript := case
    when nullif(v_session.transcript_running, '') is null then v_line
    else v_session.transcript_running || E'\n' || v_line
  end;

  update public.live_sessions
  set transcript_running = v_transcript
  where id = v_session.id;

  return query select
    'saved'::text,
    v_segment_id,
    v_call.id,
    v_ordinal,
    p_at_ms,
    v_transcript,
    true;
end
$function$;

create function public.end_owned_live_attempt(
  p_actor_employee_id uuid,
  p_actor_email text,
  p_session_id uuid
)
returns table(
  result_code text,
  session_id uuid,
  call_id uuid,
  transcript_id uuid,
  status text,
  already_ended boolean
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz;
  v_lead_id uuid;
  v_call_id uuid;
  v_actor public.app_users%rowtype;
  v_lead public.leads%rowtype;
  v_call public.calls%rowtype;
  v_session public.live_sessions%rowtype;
  v_transcript_id uuid;
  v_transcript text;
  v_vertical_id uuid;
  v_duration_seconds integer;
begin
  if p_actor_employee_id is null
    or nullif(btrim(p_actor_email), '') is null
    or p_session_id is null
  then
    return query select
      'invalid_input'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text,
      false;
    return;
  end if;

  select session_record.call_id, session_record.lead_id
  into v_call_id, v_lead_id
  from public.live_sessions as session_record
  where session_record.id = p_session_id;

  if not found or v_call_id is null or v_lead_id is null then
    return query select
      'session_missing'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text,
      false;
    return;
  end if;

  select actor_record.* into v_actor
  from public.app_users as actor_record
  where actor_record.id = p_actor_employee_id
  for update;

  if not found
    or lower(btrim(v_actor.email)) <> lower(btrim(p_actor_email))
    or v_actor.role not in ('rep', 'office', 'owner', 'admin')
  then
    return query select
      'actor_inactive'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text,
      false;
    return;
  end if;

  select lead_record.* into v_lead
  from public.leads as lead_record
  where lead_record.id = v_lead_id
  for update;

  select call_record.* into v_call
  from public.calls as call_record
  where call_record.id = v_call_id
  for update;

  select session_record.* into v_session
  from public.live_sessions as session_record
  where session_record.id = p_session_id
  for update;

  if v_lead.id is null
    or v_call.id is null
    or v_session.id is null
    or v_call.lead_id is distinct from v_lead.id
    or v_call.rep_employee_id is distinct from v_actor.id
    or lower(btrim(coalesce(v_call.rep_email, ''))) <> lower(btrim(v_actor.email))
    or v_session.call_id is distinct from v_call.id
    or v_session.lead_id is distinct from v_lead.id
    or v_session.mode <> 'twilio'
  then
    return query select
      'not_owned'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text,
      false;
    return;
  end if;

  if v_session.status in ('completed', 'abandoned', 'pending_outcome') then
    return query select
      'already_ended'::text,
      v_session.id,
      v_call.id,
      v_call.transcript_id,
      v_session.status,
      true;
    return;
  end if;

  if v_lead.status <> 'claimed'
    or v_lead.claimed_employee_id is distinct from v_actor.id
    or lower(btrim(coalesce(v_lead.claimed_by, ''))) <> lower(btrim(v_actor.email))
  then
    return query select
      'claim_lost'::text,
      v_session.id,
      v_call.id,
      v_call.transcript_id,
      v_session.status,
      false;
    return;
  end if;

  v_now := clock_timestamp();

  if v_session.status = 'starting' then
    update public.calls
    set ended_at = coalesce(ended_at, v_now),
        metric_scope = 'pending'
    where id = v_call.id;

    update public.live_sessions
    set status = 'abandoned',
        ended_at = coalesce(ended_at, v_now)
    where id = v_session.id;

    return query select
      'abandoned_before_dial'::text,
      v_session.id,
      v_call.id,
      v_call.transcript_id,
      'abandoned'::text,
      false;
    return;
  end if;

  if v_session.status <> 'active' then
    return query select
      'invalid_state'::text,
      v_session.id,
      v_call.id,
      v_call.transcript_id,
      v_session.status,
      false;
    return;
  end if;

  v_transcript_id := v_call.transcript_id;
  if v_transcript_id is null then
    select string_agg(
      segment_record.speaker || ': ' || segment_record.body,
      E'\n'
      order by segment_record.ordinal
    )
    into v_transcript
    from public.live_segments as segment_record
    where segment_record.session_id = v_session.id;

    if nullif(btrim(coalesce(v_transcript, '')), '') is not null then
      if v_lead.vertical_slug is not null then
        select vertical_record.id
        into v_vertical_id
        from public.verticals as vertical_record
        where vertical_record.slug = v_lead.vertical_slug;
      end if;

      v_transcript_id := gen_random_uuid();
      v_duration_seconds := greatest(
        0,
        floor(extract(epoch from (v_now - v_session.dial_started_at)))::integer
      );

      insert into public.transcripts (
        id,
        vertical_id,
        customer_name,
        customer_phone,
        called_at,
        raw_text,
        ghl_contact_id,
        rep_email,
        direction,
        duration_seconds,
        metric_scope
      ) values (
        v_transcript_id,
        v_vertical_id,
        v_lead.full_name,
        v_session.dial_to_number,
        v_session.dial_started_at,
        v_transcript,
        v_session.dial_verified_contact_id,
        lower(btrim(v_actor.email)),
        'outbound',
        v_duration_seconds,
        'performance'
      );
    end if;
  end if;

  update public.calls as call_to_end
  set ended_at = coalesce(call_to_end.ended_at, v_now),
      transcript_id = coalesce(call_to_end.transcript_id, v_transcript_id),
      metric_scope = 'performance'
  where call_to_end.id = v_call.id;

  update public.live_sessions
  set status = 'pending_outcome',
      ended_at = coalesce(ended_at, v_now)
  where id = v_session.id;

  return query select
    'ended'::text,
    v_session.id,
    v_call.id,
    v_transcript_id,
    'pending_outcome'::text,
    false;
end
$function$;

create function public.abandon_owned_live_attempt(
  p_actor_employee_id uuid,
  p_actor_email text,
  p_session_id uuid
)
returns table(
  result_code text,
  session_id uuid,
  call_id uuid,
  status text,
  already_abandoned boolean
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz;
  v_lead_id uuid;
  v_call_id uuid;
  v_actor public.app_users%rowtype;
  v_lead public.leads%rowtype;
  v_call public.calls%rowtype;
  v_session public.live_sessions%rowtype;
begin
  if p_actor_employee_id is null
    or nullif(btrim(p_actor_email), '') is null
    or p_session_id is null
  then
    return query select
      'invalid_input'::text,
      null::uuid,
      null::uuid,
      null::text,
      false;
    return;
  end if;

  select session_record.call_id, session_record.lead_id
  into v_call_id, v_lead_id
  from public.live_sessions as session_record
  where session_record.id = p_session_id;

  if not found or v_call_id is null or v_lead_id is null then
    return query select
      'session_missing'::text,
      null::uuid,
      null::uuid,
      null::text,
      false;
    return;
  end if;

  select actor_record.* into v_actor
  from public.app_users as actor_record
  where actor_record.id = p_actor_employee_id
  for update;

  if not found
    or lower(btrim(v_actor.email)) <> lower(btrim(p_actor_email))
    or v_actor.role not in ('rep', 'office', 'owner', 'admin')
  then
    return query select
      'actor_inactive'::text,
      null::uuid,
      null::uuid,
      null::text,
      false;
    return;
  end if;

  select lead_record.* into v_lead
  from public.leads as lead_record
  where lead_record.id = v_lead_id
  for update;

  select call_record.* into v_call
  from public.calls as call_record
  where call_record.id = v_call_id
  for update;

  select session_record.* into v_session
  from public.live_sessions as session_record
  where session_record.id = p_session_id
  for update;

  if v_lead.id is null
    or v_call.id is null
    or v_session.id is null
    or v_call.lead_id is distinct from v_lead.id
    or v_call.rep_employee_id is distinct from v_actor.id
    or lower(btrim(coalesce(v_call.rep_email, ''))) <> lower(btrim(v_actor.email))
    or v_session.call_id is distinct from v_call.id
    or v_session.lead_id is distinct from v_lead.id
    or v_session.mode <> 'twilio'
  then
    return query select
      'not_owned'::text,
      null::uuid,
      null::uuid,
      null::text,
      false;
    return;
  end if;

  if v_session.status = 'abandoned' then
    return query select
      'already_abandoned'::text,
      v_session.id,
      v_call.id,
      v_session.status,
      true;
    return;
  end if;

  if v_lead.status <> 'claimed'
    or v_lead.claimed_employee_id is distinct from v_actor.id
    or lower(btrim(coalesce(v_lead.claimed_by, ''))) <> lower(btrim(v_actor.email))
  then
    return query select
      'claim_lost'::text,
      v_session.id,
      v_call.id,
      v_session.status,
      false;
    return;
  end if;

  if v_session.status <> 'starting'
    or v_session.dial_started_at is not null
    or exists (
      select 1
      from public.live_segments as segment_record
      where segment_record.session_id = v_session.id
    )
  then
    return query select
      'real_call_cannot_abandon'::text,
      v_session.id,
      v_call.id,
      v_session.status,
      false;
    return;
  end if;

  v_now := clock_timestamp();

  update public.calls
  set ended_at = coalesce(ended_at, v_now),
      metric_scope = 'pending'
  where id = v_call.id;

  update public.live_sessions
  set status = 'abandoned',
      ended_at = coalesce(ended_at, v_now)
  where id = v_session.id;

  return query select
    'abandoned'::text,
    v_session.id,
    v_call.id,
    'abandoned'::text,
    false;
end
$function$;

create function public.complete_owned_lead_call(
  p_actor_employee_id uuid,
  p_actor_auth_user_id text,
  p_actor_email text,
  p_lead_id uuid,
  p_completion_request_id uuid,
  p_session_id uuid,
  p_outcome text,
  p_notes text,
  p_raw_transcript text,
  p_verified_contact_id text,
  p_call_permission_verified boolean
)
returns table(
  result_code text,
  call_id uuid,
  session_id uuid,
  transcript_id uuid,
  status text
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz;
  v_actor public.app_users%rowtype;
  v_lead public.leads%rowtype;
  v_call public.calls%rowtype;
  v_session public.live_sessions%rowtype;
  v_existing_call_id uuid;
  v_call_id uuid;
  v_session_call_id uuid;
  v_transcript_id uuid;
  v_vertical_id uuid;
  v_existing_raw_transcript text;
  v_raw_transcript text := nullif(btrim(coalesce(p_raw_transcript, '')), '');
  v_notes text := coalesce(p_notes, '');
  v_direction text;
begin
  if p_actor_employee_id is null
    or nullif(btrim(p_actor_auth_user_id), '') is null
    or nullif(btrim(p_actor_email), '') is null
    or p_lead_id is null
    or p_completion_request_id is null
    or p_outcome is null
    or p_outcome in (
      'interested',
      'callback',
      'not_interested',
      'wrong_number',
      'voicemail',
      'no_answer'
    ) is not true
  then
    return query select
      'invalid_input'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text;
    return;
  end if;

  select actor_record.* into v_actor
  from public.app_users as actor_record
  where actor_record.id = p_actor_employee_id
  for update;

  if not found
    or lower(btrim(v_actor.email)) <> lower(btrim(p_actor_email))
    or v_actor.role not in ('rep', 'office', 'owner', 'admin')
  then
    return query select
      'actor_inactive'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text;
    return;
  end if;

  select lead_record.* into v_lead
  from public.leads as lead_record
  where lead_record.id = p_lead_id
  for update;

  if not found then
    return query select
      'lead_missing'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text;
    return;
  end if;

  -- This routine completes calls initiated from the employee console. They
  -- are outbound regardless of how the lead originally entered the queue.
  -- Authenticated inbound recording ingestion uses its separate path.
  v_direction := 'outbound';

  -- A repeated request is resolved before the lead's now-terminal state is
  -- checked. The same request id never inserts a second call or transcript.
  select call_record.id
  into v_existing_call_id
  from public.calls as call_record
  where call_record.completion_request_id = p_completion_request_id;

  if found then
    select call_record.* into v_call
    from public.calls as call_record
    where call_record.id = v_existing_call_id
    for update;

    select session_record.* into v_session
    from public.live_sessions as session_record
    where session_record.call_id = v_call.id
      for update;

    -- A matching completion request must point at a fully committed terminal
    -- call. A malformed or partially repaired historical row is a conflict,
    -- never a successful idempotent retry.
    if v_call.id is null
      or v_call.outcome is null
      or v_call.ended_at is null
      or v_call.metric_scope <> 'performance'
      or (v_session.id is not null and v_session.status <> 'completed')
    then
      return query select
        'request_conflict'::text,
        null::uuid,
        null::uuid,
        null::uuid,
        null::text;
      return;
    end if;

    if p_session_id is null and v_call.transcript_id is not null then
      select transcript_record.raw_text
      into v_existing_raw_transcript
      from public.transcripts as transcript_record
      where transcript_record.id = v_call.transcript_id
      for share;
    end if;

    if v_call.lead_id is distinct from v_lead.id
      or v_call.rep_employee_id is distinct from v_actor.id
      or lower(btrim(coalesce(v_call.rep_email, ''))) <> lower(btrim(v_actor.email))
      or v_call.direction is distinct from v_direction
      or v_call.outcome is distinct from p_outcome
      or coalesce(v_call.notes, '') is distinct from v_notes
      or (
        p_session_id is null
        and v_existing_raw_transcript is distinct from v_raw_transcript
      )
      or (p_session_id is not null and v_raw_transcript is not null)
      or (
        p_session_id is not null
        and (v_session.id is null or v_session.id is distinct from p_session_id)
      )
      or (
        p_session_id is null
        and v_session.id is not null
      )
    then
      return query select
        'request_conflict'::text,
        null::uuid,
        null::uuid,
        null::uuid,
        null::text;
      return;
    end if;

    return query select
      'already_completed'::text,
      v_call.id,
      v_session.id,
      v_call.transcript_id,
      coalesce(v_session.status, 'completed');
    return;
  end if;

  if v_lead.status <> 'claimed'
    or v_lead.claimed_employee_id is distinct from v_actor.id
    or lower(btrim(coalesce(v_lead.claimed_by, ''))) <> lower(btrim(v_actor.email))
  then
    return query select
      'not_claimed_by_actor'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text;
    return;
  end if;

  -- This is deliberately after the completion-request recovery branch. A
  -- fresh manual completion requires a current positive provider permission
  -- snapshot. A pending Twilio attempt was already bound to that permission
  -- when its dial grant was consumed; recording its outcome sends nothing and
  -- must remain possible if the customer opts out after the call.
  if p_session_id is null
    and (
      p_call_permission_verified is not true
      or nullif(btrim(p_verified_contact_id), '') is null
      or v_lead.ghl_contact_id is distinct from btrim(p_verified_contact_id)
    )
  then
    return query select
      'call_not_authorized'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text;
    return;
  end if;

  if p_session_id is null and exists (
    select 1
    from public.live_sessions as open_session
    where open_session.lead_id = v_lead.id
      and open_session.status in ('starting', 'active', 'pending_outcome')
  ) then
    return query select
      'open_attempt_exists'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text;
    return;
  end if;

  if p_session_id is not null and exists (
    select 1
    from public.live_sessions as other_open_session
    where other_open_session.lead_id = v_lead.id
      and other_open_session.id <> p_session_id
      and other_open_session.status in (
        'starting',
        'active',
        'pending_outcome'
      )
  ) then
    return query select
      'other_open_attempt_exists'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text;
    return;
  end if;

  if v_lead.vertical_slug is not null then
    select vertical_record.id
    into v_vertical_id
    from public.verticals as vertical_record
    where vertical_record.slug = v_lead.vertical_slug;
  end if;

  if p_session_id is null then
    v_now := clock_timestamp();
    v_call_id := gen_random_uuid();

    insert into public.calls (
      id,
      lead_id,
      ghl_contact_id,
      rep_email,
      rep_employee_id,
      direction,
      outcome,
      notes,
      started_at,
      ended_at,
      metric_scope,
      completion_request_id
    ) values (
      v_call_id,
      v_lead.id,
      v_lead.ghl_contact_id,
      lower(btrim(v_actor.email)),
      v_actor.id,
      v_direction,
      p_outcome,
      v_notes,
      v_now,
      v_now,
      'performance',
      p_completion_request_id
    );

    if v_raw_transcript is not null then
      v_transcript_id := gen_random_uuid();
      insert into public.transcripts (
        id,
        vertical_id,
        customer_name,
        customer_phone,
        called_at,
        raw_text,
        ghl_contact_id,
        rep_email,
        direction,
        metric_scope
      ) values (
        v_transcript_id,
        v_vertical_id,
        v_lead.full_name,
        v_lead.phone,
        v_now,
        v_raw_transcript,
        v_lead.ghl_contact_id,
        lower(btrim(v_actor.email)),
        v_direction,
        'performance'
      );

      update public.calls
      set transcript_id = v_transcript_id
      where id = v_call_id;
    end if;
  else
    if v_raw_transcript is not null then
      return query select
        'invalid_live_input'::text,
        null::uuid,
        null::uuid,
        null::uuid,
        null::text;
      return;
    end if;

    -- Discover the call id without a lock, then lock call before session and
    -- revalidate the relationship under both locks.
    select session_record.call_id
    into v_session_call_id
    from public.live_sessions as session_record
    where session_record.id = p_session_id;

    if not found then
      return query select
        'session_missing'::text,
        null::uuid,
        null::uuid,
        null::uuid,
        null::text;
      return;
    end if;

    select call_record.* into v_call
    from public.calls as call_record
    where call_record.id = v_session_call_id
    for update;

    select session_record.* into v_session
    from public.live_sessions as session_record
    where session_record.id = p_session_id
    for update;

    if v_call.id is null
      or v_session.id is null
      or v_call.lead_id is distinct from v_lead.id
      or v_call.rep_employee_id is distinct from v_actor.id
      or lower(btrim(coalesce(v_call.rep_email, ''))) <> lower(btrim(v_actor.email))
      or v_session.call_id is distinct from v_call.id
      or v_session.lead_id is distinct from v_lead.id
      or v_session.mode <> 'twilio'
      or v_session.status <> 'pending_outcome'
      or v_call.outcome is not null
      or v_call.completion_request_id is not null
    then
      return query select
        'invalid_live_state'::text,
        null::uuid,
        null::uuid,
        null::uuid,
        null::text;
      return;
    end if;

    v_call_id := v_call.id;
    v_transcript_id := v_call.transcript_id;
    v_now := clock_timestamp();

    update public.calls
    set outcome = p_outcome,
        notes = v_notes,
        ended_at = coalesce(ended_at, v_now),
        metric_scope = 'performance',
        completion_request_id = p_completion_request_id
    where id = v_call.id;

    update public.live_sessions
    set status = 'completed'
    where id = v_session.id;
  end if;

  update public.leads
  set status = 'done',
      done_at = coalesce(done_at, v_now)
  where id = v_lead.id;

  insert into public.events_log (kind, detail)
  values (
    'lead_call_completed',
    jsonb_build_object(
      'actingEmployeeId', v_actor.id,
      'actingAuthUserId', btrim(p_actor_auth_user_id),
      'leadId', v_lead.id,
      'callId', v_call_id,
      'sessionId', p_session_id,
      'completionRequestId', p_completion_request_id
    )
  );

  return query select
    'completed'::text,
    v_call_id,
    p_session_id,
    v_transcript_id,
    'completed'::text;
end
$function$;

create function public.update_owned_followup_draft(
  p_actor_employee_id uuid,
  p_actor_email text,
  p_followup_id uuid,
  p_subject text,
  p_body text
)
returns table(result_code text, followup_id uuid)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_call_id uuid;
  v_lead_id uuid;
  v_session_id uuid;
  v_actor public.app_users%rowtype;
  v_lead public.leads%rowtype;
  v_call public.calls%rowtype;
  v_session public.live_sessions%rowtype;
  v_followup public.followups%rowtype;
begin
  if p_actor_employee_id is null
    or nullif(btrim(p_actor_email), '') is null
    or p_followup_id is null
    or nullif(btrim(p_body), '') is null
  then
    return query select 'invalid_input'::text, null::uuid;
    return;
  end if;

  select followup_record.call_id, call_record.lead_id
  into v_call_id, v_lead_id
  from public.followups as followup_record
  join public.calls as call_record on call_record.id = followup_record.call_id
  where followup_record.id = p_followup_id;

  if not found or v_call_id is null or v_lead_id is null then
    return query select 'followup_missing'::text, null::uuid;
    return;
  end if;

  select session_record.id into v_session_id
  from public.live_sessions as session_record
  where session_record.call_id = v_call_id;

  select actor_record.* into v_actor
  from public.app_users as actor_record
  where actor_record.id = p_actor_employee_id
  for update;

  if not found
    or lower(btrim(v_actor.email)) <> lower(btrim(p_actor_email))
    or v_actor.role not in ('rep', 'office', 'owner', 'admin')
  then
    return query select 'actor_inactive'::text, null::uuid;
    return;
  end if;

  select lead_record.* into v_lead
  from public.leads as lead_record
  where lead_record.id = v_lead_id
  for update;

  select call_record.* into v_call
  from public.calls as call_record
  where call_record.id = v_call_id
  for update;

  if v_session_id is not null then
    select session_record.* into v_session
    from public.live_sessions as session_record
    where session_record.id = v_session_id
    for update;
  end if;

  select followup_record.* into v_followup
  from public.followups as followup_record
  where followup_record.id = p_followup_id
  for update;

  if v_lead.id is null
    or v_call.id is null
    or v_followup.id is null
    or v_call.lead_id is distinct from v_lead.id
    or v_call.rep_employee_id is distinct from v_actor.id
    or lower(btrim(coalesce(v_call.rep_email, ''))) <> lower(btrim(v_actor.email))
    or v_followup.call_id is distinct from v_call.id
    or (
      v_session_id is not null
      and (
        v_session.id is null
        or v_session.call_id is distinct from v_call.id
        or v_session.lead_id is distinct from v_lead.id
      )
    )
  then
    return query select 'not_owned'::text, null::uuid;
    return;
  end if;

  if v_followup.status <> 'draft' then
    return query select 'not_draft'::text, v_followup.id;
    return;
  end if;

  update public.followups
  set subject = case
        when v_followup.kind = 'email' then coalesce(p_subject, '')
        else null
      end,
      body = btrim(p_body)
  where id = v_followup.id;

  return query select 'updated'::text, v_followup.id;
end
$function$;

create function public.begin_owned_followup_send(
  p_actor_employee_id uuid,
  p_actor_email text,
  p_followup_id uuid,
  p_send_attempt_id uuid
)
returns table(
  result_code text,
  followup_id uuid,
  call_id uuid,
  kind text,
  to_address text,
  subject text,
  body text,
  ghl_contact_id text,
  send_attempt_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz;
  v_call_id uuid;
  v_lead_id uuid;
  v_session_id uuid;
  v_actor public.app_users%rowtype;
  v_lead public.leads%rowtype;
  v_call public.calls%rowtype;
  v_session public.live_sessions%rowtype;
  v_followup public.followups%rowtype;
  v_ghl_contact_id text;
begin
  if p_actor_employee_id is null
    or nullif(btrim(p_actor_email), '') is null
    or p_followup_id is null
    or p_send_attempt_id is null
  then
    return query select
      'invalid_input'::text,
      null::uuid,
      null::uuid,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      null::uuid;
    return;
  end if;

  select followup_record.call_id, call_record.lead_id
  into v_call_id, v_lead_id
  from public.followups as followup_record
  join public.calls as call_record on call_record.id = followup_record.call_id
  where followup_record.id = p_followup_id;

  if not found or v_call_id is null or v_lead_id is null then
    return query select
      'followup_missing'::text,
      null::uuid,
      null::uuid,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      null::uuid;
    return;
  end if;

  select session_record.id into v_session_id
  from public.live_sessions as session_record
  where session_record.call_id = v_call_id;

  select actor_record.* into v_actor
  from public.app_users as actor_record
  where actor_record.id = p_actor_employee_id
  for update;

  if not found
    or lower(btrim(v_actor.email)) <> lower(btrim(p_actor_email))
    or v_actor.role not in ('rep', 'office', 'owner', 'admin')
  then
    return query select
      'actor_inactive'::text,
      null::uuid,
      null::uuid,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      null::uuid;
    return;
  end if;

  select lead_record.* into v_lead
  from public.leads as lead_record
  where lead_record.id = v_lead_id
  for update;

  select call_record.* into v_call
  from public.calls as call_record
  where call_record.id = v_call_id
  for update;

  if v_session_id is not null then
    select session_record.* into v_session
    from public.live_sessions as session_record
    where session_record.id = v_session_id
    for update;
  end if;

  select followup_record.* into v_followup
  from public.followups as followup_record
  where followup_record.id = p_followup_id
  for update;

  if v_lead.id is null
    or v_call.id is null
    or v_followup.id is null
    or v_call.lead_id is distinct from v_lead.id
    or v_call.rep_employee_id is distinct from v_actor.id
    or lower(btrim(coalesce(v_call.rep_email, ''))) <> lower(btrim(v_actor.email))
    or v_followup.call_id is distinct from v_call.id
    or v_call.outcome is null
    or (
      v_session_id is not null
      and (
        v_session.id is null
        or v_session.call_id is distinct from v_call.id
        or v_session.lead_id is distinct from v_lead.id
        or v_session.status <> 'completed'
      )
    )
  then
    return query select
      'not_owned_or_incomplete'::text,
      null::uuid,
      null::uuid,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      null::uuid;
    return;
  end if;

  if v_followup.status = 'sending'
    and v_followup.send_attempt_id = p_send_attempt_id
  then
    return query select
      'in_progress'::text,
      v_followup.id,
      v_call.id,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      v_followup.send_attempt_id;
    return;
  end if;

  if v_followup.status <> 'draft' then
    return query select
      v_followup.status,
      v_followup.id,
      v_call.id,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      v_followup.send_attempt_id;
    return;
  end if;

  v_ghl_contact_id := coalesce(
    nullif(btrim(coalesce(v_call.ghl_contact_id, '')), ''),
    nullif(btrim(coalesce(v_lead.ghl_contact_id, '')), '')
  );
  if v_ghl_contact_id is null then
    return query select
      'missing_contact'::text,
      v_followup.id,
      v_call.id,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      null::uuid;
    return;
  end if;

  v_now := clock_timestamp();
  update public.followups
  set status = 'sending',
      send_attempt_id = p_send_attempt_id,
      send_started_at = v_now,
      sent_at = null
  where id = v_followup.id;

  return query select
    'ready'::text,
    v_followup.id,
    v_call.id,
    v_followup.kind,
    v_followup.to_address,
    v_followup.subject,
    v_followup.body,
    v_ghl_contact_id,
    p_send_attempt_id;
end
$function$;

create function public.finish_owned_followup_send(
  p_actor_employee_id uuid,
  p_actor_email text,
  p_followup_id uuid,
  p_send_attempt_id uuid,
  p_result text,
  p_provider_message_id text
)
returns table(result_code text, followup_id uuid, status text)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz;
  v_call_id uuid;
  v_lead_id uuid;
  v_session_id uuid;
  v_actor public.app_users%rowtype;
  v_lead public.leads%rowtype;
  v_call public.calls%rowtype;
  v_session public.live_sessions%rowtype;
  v_followup public.followups%rowtype;
  v_target_status text;
begin
  if p_actor_employee_id is null
    or nullif(btrim(p_actor_email), '') is null
    or p_followup_id is null
    or p_send_attempt_id is null
    or p_result is null
    or p_result in ('sent', 'definite_failure', 'unknown') is not true
    or (
      p_result = 'sent'
      and nullif(btrim(coalesce(p_provider_message_id, '')), '') is null
    )
    or (
      p_result <> 'sent'
      and nullif(btrim(coalesce(p_provider_message_id, '')), '') is not null
    )
  then
    return query select 'invalid_input'::text, null::uuid, null::text;
    return;
  end if;

  select followup_record.call_id, call_record.lead_id
  into v_call_id, v_lead_id
  from public.followups as followup_record
  join public.calls as call_record on call_record.id = followup_record.call_id
  where followup_record.id = p_followup_id;

  if not found or v_call_id is null or v_lead_id is null then
    return query select 'followup_missing'::text, null::uuid, null::text;
    return;
  end if;

  select session_record.id into v_session_id
  from public.live_sessions as session_record
  where session_record.call_id = v_call_id;

  select actor_record.* into v_actor
  from public.app_users as actor_record
  where actor_record.id = p_actor_employee_id
  for update;

  if not found
    or lower(btrim(v_actor.email)) <> lower(btrim(p_actor_email))
    or v_actor.role not in ('rep', 'office', 'owner', 'admin')
  then
    return query select 'actor_inactive'::text, null::uuid, null::text;
    return;
  end if;

  select lead_record.* into v_lead
  from public.leads as lead_record
  where lead_record.id = v_lead_id
  for update;

  select call_record.* into v_call
  from public.calls as call_record
  where call_record.id = v_call_id
  for update;

  if v_session_id is not null then
    select session_record.* into v_session
    from public.live_sessions as session_record
    where session_record.id = v_session_id
    for update;
  end if;

  select followup_record.* into v_followup
  from public.followups as followup_record
  where followup_record.id = p_followup_id
  for update;

  if v_lead.id is null
    or v_call.id is null
    or v_followup.id is null
    or v_call.lead_id is distinct from v_lead.id
    or v_call.rep_employee_id is distinct from v_actor.id
    or lower(btrim(coalesce(v_call.rep_email, ''))) <> lower(btrim(v_actor.email))
    or v_followup.call_id is distinct from v_call.id
    or (
      v_session_id is not null
      and (
        v_session.id is null
        or v_session.call_id is distinct from v_call.id
        or v_session.lead_id is distinct from v_lead.id
      )
    )
  then
    return query select 'not_owned'::text, null::uuid, null::text;
    return;
  end if;

  v_target_status := case p_result
    when 'sent' then 'approved_sent'
    when 'definite_failure' then 'draft'
    else 'send_unknown'
  end;

  if v_followup.send_attempt_id = p_send_attempt_id
    and v_followup.status = v_target_status
    and (
      p_result <> 'sent'
      or v_followup.provider_message_id = btrim(p_provider_message_id)
    )
  then
    return query select
      'already_finished'::text,
      v_followup.id,
      v_followup.status;
    return;
  end if;

  if v_followup.status <> 'sending'
    or v_followup.send_attempt_id is distinct from p_send_attempt_id
  then
    return query select
      'attempt_conflict'::text,
      v_followup.id,
      v_followup.status;
    return;
  end if;

  v_now := clock_timestamp();
  update public.followups
  set status = v_target_status,
      send_attempt_id = case
        when p_result = 'definite_failure' then null
        else send_attempt_id
      end,
      send_started_at = case
        when p_result = 'definite_failure' then null
        else send_started_at
      end,
      sent_at = case when p_result = 'sent' then v_now else null end,
      provider_message_id = case
        when p_result = 'sent' then btrim(p_provider_message_id)
        else provider_message_id
      end
  where id = v_followup.id;

  return query select
    'finished'::text,
    v_followup.id,
    v_target_status;
end
$function$;

-- PostgreSQL grants function execution to PUBLIC by default. Migration 0019
-- changes the default ACL, and these explicit revokes make this migration
-- safe even if it is applied by a role with different historical defaults.
revoke all privileges on function
  public.assert_legacy_metric_artifacts_reconciled(),
  public.assert_personal_touch_metric_provenance(),
  public.is_contact_calling_time_allowed(timestamptz, text),
  public.enforce_call_metric_scope(),
  public.enforce_transcript_metric_scope(),
  public.enforce_call_score_metric_scope(),
  public.enforce_live_session_transition(),
  public.enforce_followup_provider_message_immutable(),
  public.reject_live_segment_mutation(),
  public.decide_queued_lead(uuid, text, text, uuid, text, text, boolean, text),
  public.start_claimed_live_attempt(uuid, text, text, uuid, text, uuid),
  public.consume_authorized_live_dial(text, text, text, text, text, text),
  public.consume_authorized_live_stream(uuid, text),
  public.append_authorized_live_segment(uuid, uuid, text, text, integer, integer),
  public.end_owned_live_attempt(uuid, text, uuid),
  public.abandon_owned_live_attempt(uuid, text, uuid),
  public.complete_owned_lead_call(uuid, text, text, uuid, uuid, uuid, text, text, text, text, boolean),
  public.update_owned_followup_draft(uuid, text, uuid, text, text),
  public.begin_owned_followup_send(uuid, text, uuid, uuid),
  public.finish_owned_followup_send(uuid, text, uuid, uuid, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.assert_legacy_metric_artifacts_reconciled(),
  public.assert_personal_touch_metric_provenance(),
  public.is_contact_calling_time_allowed(timestamptz, text),
  public.enforce_call_metric_scope(),
  public.enforce_transcript_metric_scope(),
  public.enforce_call_score_metric_scope(),
  public.enforce_live_session_transition(),
  public.enforce_followup_provider_message_immutable(),
  public.reject_live_segment_mutation(),
  public.decide_queued_lead(uuid, text, text, uuid, text, text, boolean, text),
  public.start_claimed_live_attempt(uuid, text, text, uuid, text, uuid),
  public.consume_authorized_live_dial(text, text, text, text, text, text),
  public.consume_authorized_live_stream(uuid, text),
  public.append_authorized_live_segment(uuid, uuid, text, text, integer, integer),
  public.end_owned_live_attempt(uuid, text, uuid),
  public.abandon_owned_live_attempt(uuid, text, uuid),
  public.complete_owned_lead_call(uuid, text, text, uuid, uuid, uuid, text, text, text, text, boolean),
  public.update_owned_followup_draft(uuid, text, uuid, text, text),
  public.begin_owned_followup_send(uuid, text, uuid, uuid),
  public.finish_owned_followup_send(uuid, text, uuid, uuid, text, text)
to service_role;

reset lock_timeout;
reset statement_timeout;
