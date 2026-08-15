-- Apply after migrations 0001..0019 and before migration 0020. This fixture
-- proves that an existing personal-touch task sourced from an ambiguous
-- transcript stops migration before any schema change is persisted.

insert into public.transcripts (
  id,
  source_file,
  raw_text,
  outcome
) values (
  '81000000-0000-0000-0000-000000000101',
  null,
  'legacy transcript with no positive performance evidence',
  'unknown'
);

insert into public.second_mile_touches (
  id,
  kind,
  status,
  payload,
  dedupe_key
) values
  (
    '81000000-0000-0000-0000-000000000201',
    'personal_touch',
    'pending',
    jsonb_build_object(
      'transcript_id',
      '81000000-0000-0000-0000-000000000101'
    ),
    'personal_touch:ambiguous-preflight-fixture'
  ),
  (
    '81000000-0000-0000-0000-000000000202',
    'personal_touch',
    'pending',
    '{}'::jsonb,
    'personal_touch:missing-id-preflight-fixture'
  ),
  (
    '81000000-0000-0000-0000-000000000203',
    'personal_touch',
    'pending',
    jsonb_build_object(
      'transcript_id',
      'not-a-transcript-id'
    ),
    'personal_touch:malformed-id-preflight-fixture'
  );
