begin;

create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;

select no_plan();

select col_is_null(
  'public',
  'transcripts',
  'commitments_extracted_at',
  'the extraction timestamp remains nullable for pending transcripts'
);

select col_is_null(
  'public',
  'transcripts',
  'commitment_extracted_count',
  'the extraction count remains nullable when an exceptional legacy result has no proven count'
);

select col_not_null(
  'public',
  'transcripts',
  'commitment_extraction_attempts',
  'every transcript has a durable extraction-attempt counter'
);

select col_not_null(
  'public',
  'transcripts',
  'commitment_extraction_terminal_failures',
  'every transcript has a durable deterministic-failure counter'
);

select is(
  (
    select commitments_extracted_at
    from public.transcripts
    where id = '24000000-0000-4000-8000-000000000101'
  ),
  '2026-08-18T12:01:00Z'::timestamptz,
  'a transcript with legacy commitments is marked at the latest stored commitment time'
);

select is(
  (
    select commitment_extracted_count
    from public.transcripts
    where id = '24000000-0000-4000-8000-000000000101'
  ),
  2,
  'the legacy commitment count is backfilled exactly'
);

select is(
  (
    select commitment_extractor_version
    from public.transcripts
    where id = '24000000-0000-4000-8000-000000000101'
  ),
  'legacy-call-commitments-v1',
  'the backfill records an explicit legacy extractor version'
);

select is(
  (
    select commitments_extracted_at
    from public.transcripts
    where id = '24000000-0000-4000-8000-000000000102'
  ),
  null::timestamptz,
  'a transcript with no stored commitments remains pending because legacy completion cannot be proven'
);

select throws_ok(
  $sql$
    update public.transcripts
    set commitment_extracted_count = -1
    where id = '24000000-0000-4000-8000-000000000102'
  $sql$,
  '23514',
  null,
  'negative extracted counts are rejected'
);

select throws_ok(
  $sql$
    update public.transcripts
    set commitments_extracted_at = now()
    where id = '24000000-0000-4000-8000-000000000102'
  $sql$,
  '23514',
  null,
  'a completed timestamp without an extractor version is rejected'
);

select ok(
  to_regprocedure('public.call_commitments_finalize_extraction(uuid,jsonb,text)') is not null,
  'the atomic extraction finalizer is installed'
);

select ok(
  to_regprocedure('public.advance_recording_sync_cursor(timestamptz,jsonb)') is not null,
  'the monotonic recording cursor routine is installed'
);

select ok(
  to_regprocedure('public.record_commitment_extraction_failure(uuid,text)') is not null,
  'the failure-state transition routine is installed'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.call_commitments_finalize_extraction(uuid,jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.call_commitments_finalize_extraction(uuid,jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.call_commitments_finalize_extraction(uuid,jsonb,text)',
    'EXECUTE'
  ),
  'only service_role can finalize commitment extraction'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.call_commitments_upsert_batch(uuid,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.call_commitments_upsert_batch(uuid,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.call_commitments_upsert_batch(uuid,jsonb)',
    'EXECUTE'
  ),
  'the rolling-deploy compatibility writer remains service-role only'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.advance_recording_sync_cursor(timestamptz,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.advance_recording_sync_cursor(timestamptz,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.advance_recording_sync_cursor(timestamptz,jsonb)',
    'EXECUTE'
  ),
  'only service_role can advance the recording sync cursor'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.record_commitment_extraction_failure(uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.record_commitment_extraction_failure(uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_commitment_extraction_failure(uuid,text)',
    'EXECUTE'
  ),
  'only service_role can record commitment extraction failures'
);

insert into public.transcripts (
  id,
  source_file,
  raw_text,
  outcome,
  metric_scope
) values
  (
    '24000000-0000-4000-8000-000000000201',
    'atomic-finalizer-performance.txt',
    'Rep promised two follow-ups.',
    'unknown',
    'performance'
  ),
  (
    '24000000-0000-4000-8000-000000000202',
    'atomic-finalizer-zero.txt',
    'Rep made no commitment.',
    'unknown',
    'performance'
  ),
  (
    '24000000-0000-4000-8000-000000000203',
    'atomic-finalizer-training.txt',
    'Simulator transcript.',
    'unknown',
    'training'
  ),
  (
    '24000000-0000-4000-8000-000000000204',
    'atomic-finalizer-resolved.txt',
    'Legacy resolved commitment.',
    'unknown',
    'performance'
  ),
  (
    '24000000-0000-4000-8000-000000000205',
    'deterministic-failure-quarantine.txt',
    'Malformed transcript for deterministic retry coverage.',
    'unknown',
    'performance'
  ),
  (
    '24000000-0000-4000-8000-000000000206',
    'transient-failure-retry.txt',
    'Valid transcript during a provider outage.',
    'unknown',
    'performance'
  );

insert into public.call_commitments (
  transcript_id,
  kind,
  detail,
  extraction_index
) values
  (
    '24000000-0000-4000-8000-000000000201',
    'send_quote',
    'stale open row that must be replaced',
    0
  ),
  (
    '24000000-0000-4000-8000-000000000204',
    'send_info',
    'resolved row that must remain untouched',
    0
  );

update public.call_commitments
set status = 'cleared', cleared_at = now()
where transcript_id = '24000000-0000-4000-8000-000000000204';

update public.transcripts
set
  commitment_extraction_attempts = 3,
  commitment_extraction_terminal_failures = 3,
  commitment_extraction_last_attempt_at = now(),
  commitment_extraction_quarantined_at = now(),
  commitment_extraction_last_failure_code = 'deterministic_extraction_failed'
where id = '24000000-0000-4000-8000-000000000204';

select is(
  public.call_commitments_finalize_extraction(
    '24000000-0000-4000-8000-000000000201',
    '[{"kind":"send_quote","detail":"final quote","promised_at":null,"extraction_index":0},{"kind":"callback","detail":"call tomorrow","promised_at":"2026-08-20T13:00:00Z","extraction_index":0}]'::jsonb,
    'commitment-extractor-test-v1'
  ),
  'ok',
  'the finalizer accepts one complete performance extraction'
);

select is(
  (
    select count(*)::integer
    from public.call_commitments
    where transcript_id = '24000000-0000-4000-8000-000000000201'
  ),
  2,
  'the finalizer replaces a stale open set with the exact extracted set'
);

select is(
  (
    select commitment_extracted_count
    from public.transcripts
    where id = '24000000-0000-4000-8000-000000000201'
  ),
  2,
  'the extraction marker count commits with the rows'
);

select is(
  public.call_commitments_finalize_extraction(
    '24000000-0000-4000-8000-000000000201',
    '[]'::jsonb,
    'contradictory-retry'
  ),
  'already_finalized',
  'a later contradictory extraction is an idempotent no-op'
);

select is(
  (
    select commitment_extracted_count
    from public.transcripts
    where id = '24000000-0000-4000-8000-000000000201'
  ),
  2,
  'a contradictory retry cannot rewrite the finalized count'
);

select is(
  public.call_commitments_finalize_extraction(
    '24000000-0000-4000-8000-000000000202',
    '[]'::jsonb,
    'commitment-extractor-test-v1'
  ),
  'ok',
  'a valid zero-commitment extraction is durably finalized'
);

select is(
  (
    select commitment_extracted_count
    from public.transcripts
    where id = '24000000-0000-4000-8000-000000000202'
  ),
  0,
  'zero commitments has an explicit zero marker rather than remaining pending'
);

select throws_ok(
  $sql$
    select public.call_commitments_finalize_extraction(
      '24000000-0000-4000-8000-000000000203',
      '[]'::jsonb,
      'commitment-extractor-test-v1'
    )
  $sql$,
  '42501',
  'commitments require a performance transcript',
  'training transcripts cannot publish employee commitment statistics'
);

select is(
  public.call_commitments_finalize_extraction(
    '24000000-0000-4000-8000-000000000204',
    '[{"kind":"send_info","detail":"must not overwrite","promised_at":null,"extraction_index":0}]'::jsonb,
    'commitment-extractor-test-v1'
  ),
  'refused',
  'a legacy resolved commitment refuses re-extraction'
);

select is(
  (
    select detail
    from public.call_commitments
    where transcript_id = '24000000-0000-4000-8000-000000000204'
  ),
  'resolved row that must remain untouched',
  'a refusal leaves the resolved row untouched'
);

select ok(
  (
    select commitments_extracted_at is not null
      and commitment_extraction_quarantined_at is null
    from public.transcripts
    where id = '24000000-0000-4000-8000-000000000204'
  ),
  'a reviewed resolved commitment exits quarantine when finalization is refused'
);

select is(
  public.call_commitments_upsert_batch(
    '24000000-0000-4000-8000-000000000202',
    '[]'::jsonb
  ),
  'ok',
  'the legacy writer delegates idempotently to an already-finalized extraction'
);

select is(
  public.record_commitment_extraction_failure(
    '24000000-0000-4000-8000-000000000205',
    'deterministic_extraction_failed'
  ),
  'retry_scheduled',
  'the first deterministic failure schedules a retry'
);

select is(
  public.record_commitment_extraction_failure(
    '24000000-0000-4000-8000-000000000205',
    'deterministic_extraction_failed'
  ),
  'retry_scheduled',
  'the second deterministic failure still schedules a retry'
);

select is(
  public.record_commitment_extraction_failure(
    '24000000-0000-4000-8000-000000000205',
    'deterministic_extraction_failed'
  ),
  'quarantined',
  'the third deterministic failure enters quarantine'
);

select is(
  public.record_commitment_extraction_failure(
    '24000000-0000-4000-8000-000000000205',
    'deterministic_extraction_failed'
  ),
  'already_quarantined',
  'a fourth failure cannot mutate an existing quarantine'
);

select is(
  (
    select commitment_extraction_attempts
    from public.transcripts
    where id = '24000000-0000-4000-8000-000000000205'
  ),
  3,
  'quarantine preserves the exact three-attempt count'
);

select is(
  (
    select commitment_extraction_terminal_failures
    from public.transcripts
    where id = '24000000-0000-4000-8000-000000000205'
  ),
  3,
  'quarantine is based on deterministic failures only'
);

select ok(
  (
    select commitment_extraction_quarantined_at is not null
    from public.transcripts
    where id = '24000000-0000-4000-8000-000000000205'
  ),
  'the quarantined transcript has a durable review timestamp'
);

select is(
  public.record_commitment_extraction_failure(
    '24000000-0000-4000-8000-000000000206',
    'transient_dependency_failed'
  ),
  'retry_scheduled',
  'a transient dependency failure remains retryable'
);

select is(
  public.record_commitment_extraction_failure(
    '24000000-0000-4000-8000-000000000206',
    'transient_dependency_failed'
  ),
  'retry_scheduled',
  'a second transient dependency failure remains retryable'
);

select is(
  public.record_commitment_extraction_failure(
    '24000000-0000-4000-8000-000000000206',
    'transient_dependency_failed'
  ),
  'retry_scheduled',
  'a third transient dependency failure still cannot quarantine valid work'
);

select ok(
  (
    select commitment_extraction_attempts = 3
      and commitment_extraction_terminal_failures = 0
      and commitment_extraction_quarantined_at is null
    from public.transcripts
    where id = '24000000-0000-4000-8000-000000000206'
  ),
  'transient attempts are durable but do not count toward terminal quarantine'
);

select is(
  public.record_commitment_extraction_failure(
    '24000000-0000-4000-8000-000000000202',
    'transient_dependency_failed'
  ),
  'already_finalized',
  'a failure racing after finalization cannot change completed state'
);

select throws_ok(
  $sql$
    select public.record_commitment_extraction_failure(
      '24000000-0000-4000-8000-000000000203',
      'deterministic_extraction_failed'
    )
  $sql$,
  '42501',
  'commitments require a performance transcript',
  'training transcripts cannot enter the commitment retry state machine'
);

select throws_ok(
  $sql$
    select public.record_commitment_extraction_failure(
      '24000000-0000-4000-8000-000000000206',
      'raw-provider-message'
    )
  $sql$,
  '22023',
  'invalid commitment extraction failure code',
  'raw or unknown failure codes are rejected'
);

select throws_ok(
  $sql$
    select public.record_commitment_extraction_failure(
      '24000000-0000-4000-8000-000000000206',
      null
    )
  $sql$,
  '22023',
  'invalid commitment extraction failure code',
  'a null failure code cannot bypass the positive enum'
);

select throws_ok(
  $sql$
    update public.transcripts
    set commitment_extraction_quarantined_at = now()
    where id = '24000000-0000-4000-8000-000000000206'
  $sql$,
  '23514',
  null,
  'quarantine cannot be set without the deterministic failure threshold'
);

select is(
  public.call_commitments_finalize_extraction(
    '24000000-0000-4000-8000-000000000205',
    '[]'::jsonb,
    'reviewed-manual-retry-v1'
  ),
  'ok',
  'a reviewed successful retry can finalize a quarantined transcript'
);

select ok(
  (
    select commitments_extracted_at is not null
      and commitment_extraction_quarantined_at is null
    from public.transcripts
    where id = '24000000-0000-4000-8000-000000000205'
  ),
  'successful finalization and quarantine cannot coexist'
);

select is(
  public.advance_recording_sync_cursor(
    '2026-08-18T12:00:00Z',
    '{"run":"newer"}'::jsonb
  ),
  '2026-08-18T12:00:00Z'::timestamptz,
  'the recording cursor accepts an initial frontier'
);

select is(
  public.advance_recording_sync_cursor(
    '2026-08-17T12:00:00Z',
    '{"run":"stale"}'::jsonb
  ),
  '2026-08-18T12:00:00Z'::timestamptz,
  'a stale invocation cannot regress the recording cursor'
);

select is(
  (
    select detail ->> 'run'
    from public.recording_sync_state
    where id = 1
  ),
  'newer',
  'stale cursor detail cannot overwrite the newer frontier detail'
);

select * from finish();
rollback;
