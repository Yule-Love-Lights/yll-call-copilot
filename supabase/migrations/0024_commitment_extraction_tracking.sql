-- Durable completion tracking for the commitment backfill.
--
-- Presence in call_commitments cannot prove that extraction ran because a
-- valid transcript may contain zero commitments. Filtering the newest 200
-- transcripts and then checking call_commitments also permanently starves
-- older transcripts once the recent window is full of processed rows. These
-- transcript-owned markers let the database filter completed work before it
-- applies a batch limit.

alter table public.transcripts
  add column commitments_extracted_at timestamptz,
  add column commitment_extractor_version text,
  add column commitment_extracted_count integer,
  add column commitment_extraction_attempts integer not null default 0,
  add column commitment_extraction_terminal_failures integer not null default 0,
  add column commitment_extraction_last_attempt_at timestamptz,
  add column commitment_extraction_quarantined_at timestamptz,
  add column commitment_extraction_last_failure_code text;

alter table public.transcripts
  add constraint transcripts_commitment_extracted_count_check
  check (commitment_extracted_count is null or commitment_extracted_count >= 0),
  add constraint transcripts_commitment_extraction_marker_check
  check (
    (
      commitments_extracted_at is null
      and commitment_extractor_version is null
      and commitment_extracted_count is null
    )
    or (
      commitments_extracted_at is not null
      and nullif(btrim(commitment_extractor_version), '') is not null
    )
  ),
  add constraint transcripts_commitment_extraction_attempts_check
  check (
    commitment_extraction_attempts >= 0
    and commitment_extraction_terminal_failures >= 0
    and commitment_extraction_terminal_failures <= commitment_extraction_attempts
    and (
      (
        commitment_extraction_attempts = 0
        and commitment_extraction_terminal_failures = 0
        and commitment_extraction_last_attempt_at is null
        and commitment_extraction_quarantined_at is null
        and commitment_extraction_last_failure_code is null
      )
      or (
        commitment_extraction_attempts > 0
        and commitment_extraction_last_attempt_at is not null
        and commitment_extraction_last_failure_code in (
          'deterministic_extraction_failed',
          'transient_dependency_failed'
        )
        and (
          commitment_extraction_quarantined_at is null
          or commitment_extraction_terminal_failures >= 3
        )
      )
    )
    and not (
      commitments_extracted_at is not null
      and commitment_extraction_quarantined_at is not null
    )
  );

-- Rows with stored commitments were necessarily extracted before these
-- markers existed. Backfill them without re-running the model. The nullable
-- count remains available for the exceptional preexisting-resolved marker in
-- application code, where the exact count is not needed to prove completion.
update public.transcripts as transcript_record
set
  commitments_extracted_at = extraction.completed_at,
  commitment_extractor_version = 'legacy-call-commitments-v1',
  commitment_extracted_count = extraction.commitment_count
from (
  select
    commitment.transcript_id,
    max(commitment.created_at) as completed_at,
    count(*)::integer as commitment_count
  from public.call_commitments as commitment
  group by commitment.transcript_id
) as extraction
where transcript_record.id = extraction.transcript_id;

create index transcripts_pending_commitment_extraction_idx
  on public.transcripts (
    commitment_extraction_last_attempt_at nulls first,
    called_at,
    id
  )
  where commitments_extracted_at is null
    and commitment_extraction_quarantined_at is null
    and metric_scope = 'performance';

-- Finalize one model extraction as a single database transaction. The parent
-- transcript row is the lock even when the extractor found zero commitments,
-- so concurrent first-time workers cannot both publish contradictory results.
create function public.call_commitments_finalize_extraction(
  p_transcript_id uuid,
  p_rows jsonb,
  p_extractor_version text
) returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_metric_scope text;
  v_extracted_at timestamptz;
  v_has_resolved boolean;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'p_rows must be a JSON array';
  end if;
  if nullif(btrim(p_extractor_version), '') is null then
    raise exception using errcode = '22023', message = 'p_extractor_version is required';
  end if;

  select transcript_record.metric_scope, transcript_record.commitments_extracted_at
  into v_metric_scope, v_extracted_at
  from public.transcripts as transcript_record
  where transcript_record.id = p_transcript_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'source transcript does not exist';
  end if;
  if v_metric_scope is distinct from 'performance' then
    raise exception using errcode = '42501', message = 'commitments require a performance transcript';
  end if;
  if v_extracted_at is not null then
    return 'already_finalized';
  end if;

  select bool_or(commitment_record.status <> 'open')
  into v_has_resolved
  from (
    select locked_commitment.status
    from public.call_commitments as locked_commitment
    where locked_commitment.transcript_id = p_transcript_id
    for update
  ) as commitment_record;

  if coalesce(v_has_resolved, false) then
    update public.transcripts
    set
      commitments_extracted_at = now(),
      commitment_extractor_version = 'preexisting-resolved',
      commitment_extracted_count = null,
      commitment_extraction_quarantined_at = null
    where id = p_transcript_id;
    return 'refused';
  end if;

  -- A prior process may have committed rows and crashed before a completion
  -- marker existed. Replace the entire still-open set so a nondeterministic
  -- retry cannot leave stale rows that are absent from the final extraction.
  delete from public.call_commitments
  where transcript_id = p_transcript_id;

  insert into public.call_commitments (
    transcript_id,
    ghl_contact_id,
    rep_email,
    kind,
    detail,
    promised_at,
    extraction_index
  )
  select
    p_transcript_id,
    row_record ->> 'ghl_contact_id',
    row_record ->> 'rep_email',
    row_record ->> 'kind',
    row_record ->> 'detail',
    (row_record ->> 'promised_at')::timestamptz,
    (row_record ->> 'extraction_index')::integer
  from jsonb_array_elements(p_rows) as row_record;

  update public.transcripts
  set
    commitments_extracted_at = now(),
    commitment_extractor_version = p_extractor_version,
    commitment_extracted_count = jsonb_array_length(p_rows),
    commitment_extraction_quarantined_at = null
  where id = p_transcript_id;

  return 'ok';
end
$function$;

revoke all on function public.call_commitments_finalize_extraction(uuid, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.call_commitments_finalize_extraction(uuid, jsonb, text)
  to service_role;

-- A permanently malformed transcript or provider failure must not occupy one
-- of the oldest batch slots forever. Record each failed model/persistence
-- attempt durably, move attempted rows behind never-attempted work, and place
-- the transcript in a reviewable quarantine after three real failures.
create function public.record_commitment_extraction_failure(
  p_transcript_id uuid,
  p_failure_code text
) returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempts integer;
  v_extracted_at timestamptz;
  v_metric_scope text;
  v_quarantined_at timestamptz;
  v_terminal_failures integer;
begin
  if p_failure_code is null or p_failure_code not in (
    'deterministic_extraction_failed',
    'transient_dependency_failed'
  ) then
    raise exception using errcode = '22023', message = 'invalid commitment extraction failure code';
  end if;

  select
    transcript_record.commitment_extraction_attempts,
    transcript_record.commitments_extracted_at,
    transcript_record.metric_scope,
    transcript_record.commitment_extraction_quarantined_at,
    transcript_record.commitment_extraction_terminal_failures
  into v_attempts, v_extracted_at, v_metric_scope, v_quarantined_at, v_terminal_failures
  from public.transcripts as transcript_record
  where transcript_record.id = p_transcript_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'source transcript does not exist';
  end if;
  if v_metric_scope is distinct from 'performance' then
    raise exception using errcode = '42501', message = 'commitments require a performance transcript';
  end if;
  if v_extracted_at is not null then
    return 'already_finalized';
  end if;
  if v_quarantined_at is not null then
    return 'already_quarantined';
  end if;

  v_attempts := v_attempts + 1;
  if p_failure_code = 'deterministic_extraction_failed' then
    v_terminal_failures := v_terminal_failures + 1;
  end if;
  update public.transcripts
  set
    commitment_extraction_attempts = v_attempts,
    commitment_extraction_terminal_failures = v_terminal_failures,
    commitment_extraction_last_attempt_at = clock_timestamp(),
    commitment_extraction_last_failure_code = p_failure_code,
    commitment_extraction_quarantined_at = case
      when v_terminal_failures >= 3 then clock_timestamp()
      else null
    end
  where id = p_transcript_id;

  return case when v_terminal_failures >= 3 then 'quarantined' else 'retry_scheduled' end;
end
$function$;

revoke all on function public.record_commitment_extraction_failure(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_commitment_extraction_failure(uuid, text)
  to service_role;

-- Preserve database-first rolling deployment compatibility for the currently
-- running application. The legacy route still calls this signature, so replace
-- its implementation with a narrow delegation to the atomic finalizer instead
-- of leaving the unsafe 0022 body reachable or revoking it before new code is
-- deployed. A later cleanup migration may remove this wrapper only after every
-- deployed application version uses call_commitments_finalize_extraction.
create or replace function public.call_commitments_upsert_batch(
  p_transcript_id uuid,
  p_rows jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result text;
begin
  v_result := public.call_commitments_finalize_extraction(
    p_transcript_id,
    p_rows,
    'legacy-upsert-compat-v1'
  );

  if v_result = 'already_finalized' then
    return 'ok';
  end if;
  return v_result;
end
$function$;

revoke all on function public.call_commitments_upsert_batch(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.call_commitments_upsert_batch(uuid, jsonb)
  to service_role;

-- Cursor advancement must remain monotonic even when two cron invocations
-- overlap. The single-row upsert takes the row lock and refuses regression;
-- stale detail cannot overwrite the detail associated with a newer cursor.
create function public.advance_recording_sync_cursor(
  p_next_cursor timestamptz,
  p_detail jsonb
) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_stored_cursor timestamptz;
begin
  if p_next_cursor is null then
    raise exception using errcode = '22023', message = 'p_next_cursor is required';
  end if;

  insert into public.recording_sync_state as sync_state (id, last_synced_at, detail)
  values (1, p_next_cursor, p_detail)
  on conflict (id) do update
  set
    last_synced_at = greatest(sync_state.last_synced_at, excluded.last_synced_at),
    detail = case
      when sync_state.last_synced_at is null
        or excluded.last_synced_at >= sync_state.last_synced_at
      then excluded.detail
      else sync_state.detail
    end
  returning last_synced_at into v_stored_cursor;

  return v_stored_cursor;
end
$function$;

revoke all on function public.advance_recording_sync_cursor(timestamptz, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.advance_recording_sync_cursor(timestamptz, jsonb)
  to service_role;
