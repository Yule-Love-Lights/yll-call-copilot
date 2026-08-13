-- Apply after migrations 0001..0019 and before migration 0020. These rows
-- deliberately represent every legacy provenance class that 0020 must
-- classify without treating missing evidence as performance data.

insert into public.app_users (id, email, role) values (
  '80000000-0000-0000-0000-000000000001',
  'legacy-rep@example.invalid',
  'office'
);

insert into public.leads (
  id,
  ghl_contact_id,
  full_name,
  phone,
  reason,
  source,
  status,
  claimed_by,
  timezone,
  done_at
) values (
  '80000000-0000-0000-0000-000000000010',
  'legacy-real-contact',
  'Legacy Real Contact',
  '+15555558010',
  'seeded migration evidence',
  'inbound',
  'done',
  'legacy-rep@example.invalid',
  'UTC',
  '2026-01-01 12:10:00+00'
);

insert into public.transcripts (
  id,
  source_file,
  raw_text,
  outcome,
  rep_email,
  direction,
  called_at
) values
  (
    '80000000-0000-0000-0000-000000000101',
    'legacy-import.csv',
    'imported transcript with durable source evidence',
    'unknown',
    null,
    null,
    null
  ),
  (
    '80000000-0000-0000-0000-000000000102',
    null,
    'orphan transcript with no durable provenance',
    'unknown',
    null,
    null,
    null
  ),
  (
    '80000000-0000-0000-0000-000000000103',
    null,
    'simulator transcript',
    'unknown',
    'legacy-rep@example.invalid',
    'outbound',
    '2026-01-01 10:00:00+00'
  ),
  (
    '80000000-0000-0000-0000-000000000104',
    null,
    'verified real-call transcript',
    'booked',
    'legacy-rep@example.invalid',
    'outbound',
    '2026-01-01 12:00:00+00'
  ),
  (
    '80000000-0000-0000-0000-000000000105',
    null,
    'completed manual-call transcript',
    'not_booked',
    'legacy-rep@example.invalid',
    'outbound',
    '2026-01-01 14:00:00+00'
  ),
  (
    '80000000-0000-0000-0000-000000000106',
    null,
    'dial attempt with no historical completion evidence',
    'unknown',
    'legacy-rep@example.invalid',
    'outbound',
    '2026-01-01 16:00:00+00'
  );

insert into public.calls (
  id,
  lead_id,
  ghl_contact_id,
  rep_email,
  direction,
  outcome,
  transcript_id,
  started_at,
  ended_at
) values
  (
    '80000000-0000-0000-0000-000000000201',
    null,
    null,
    null,
    'outbound',
    null,
    null,
    '2026-01-01 09:00:00+00',
    null
  ),
  (
    '80000000-0000-0000-0000-000000000202',
    null,
    null,
    'legacy-rep@example.invalid',
    'outbound',
    'callback',
    '80000000-0000-0000-0000-000000000105',
    '2026-01-01 14:00:00+00',
    '2026-01-01 14:05:00+00'
  ),
  (
    '80000000-0000-0000-0000-000000000203',
    null,
    null,
    'legacy-rep@example.invalid',
    'outbound',
    null,
    '80000000-0000-0000-0000-000000000103',
    '2026-01-01 10:00:00+00',
    '2026-01-01 10:05:00+00'
  ),
  (
    '80000000-0000-0000-0000-000000000204',
    '80000000-0000-0000-0000-000000000010',
    'legacy-real-contact',
    'legacy-rep@example.invalid',
    'outbound',
    'interested',
    '80000000-0000-0000-0000-000000000104',
    '2026-01-01 12:00:00+00',
    '2026-01-01 12:10:00+00'
  ),
  (
    '80000000-0000-0000-0000-000000000205',
    '80000000-0000-0000-0000-000000000010',
    'legacy-real-contact',
    'legacy-rep@example.invalid',
    'outbound',
    null,
    '80000000-0000-0000-0000-000000000106',
    '2026-01-01 16:00:00+00',
    null
  );

insert into public.live_sessions (
  id,
  call_id,
  mode,
  status,
  started_at,
  ended_at,
  dial_grant_hash,
  dial_actor_auth_user_id,
  dial_grant_expires_at,
  dial_started_at,
  media_stream_grant_hash,
  media_stream_grant_expires_at,
  media_stream_started_at
) values
  (
    '80000000-0000-0000-0000-000000000301',
    '80000000-0000-0000-0000-000000000203',
    'simulator',
    'ended',
    '2026-01-01 10:00:00+00',
    '2026-01-01 10:05:00+00',
    null,
    null,
    null,
    null,
    null,
    null,
    null
  ),
  (
    '80000000-0000-0000-0000-000000000302',
    '80000000-0000-0000-0000-000000000204',
    'twilio',
    'ended',
    '2026-01-01 11:59:00+00',
    '2026-01-01 12:10:00+00',
    'legacy-real-dial-grant',
    'legacy-auth-user',
    '2026-01-01 12:04:00+00',
    '2026-01-01 12:00:00+00',
    'legacy-real-stream-grant',
    '2026-01-01 13:00:00+00',
    '2026-01-01 12:00:01+00'
  ),
  (
    '80000000-0000-0000-0000-000000000303',
    '80000000-0000-0000-0000-000000000205',
    'twilio',
    'ended',
    '2026-01-01 15:59:00+00',
    null,
    'legacy-incomplete-dial-grant',
    'legacy-auth-user',
    '2026-01-01 16:04:00+00',
    '2026-01-01 16:00:00+00',
    'legacy-incomplete-stream-grant',
    '2026-01-01 17:00:00+00',
    '2026-01-01 16:00:01+00'
  );

insert into public.second_mile_touches (
  id,
  ghl_contact_id,
  customer_name,
  kind,
  status,
  payload,
  dedupe_key
) values (
  '80000000-0000-0000-0000-000000000501',
  'legacy-real-contact',
  'Legacy Real Contact',
  'personal_touch',
  'pending',
  jsonb_build_object(
    'transcript_id',
    '80000000-0000-0000-0000-000000000104',
    'detail',
    'verified performance fixture'
  ),
  'personal_touch:legacy-performance-fixture'
);

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
  win
) values
  (
    '80000000-0000-0000-0000-000000000401',
    '80000000-0000-0000-0000-000000000101',
    1,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    0,
    0,
    'imported fixture'
  ),
  (
    '80000000-0000-0000-0000-000000000402',
    '80000000-0000-0000-0000-000000000102',
    1,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    0,
    0,
    'ambiguous fixture'
  ),
  (
    '80000000-0000-0000-0000-000000000403',
    '80000000-0000-0000-0000-000000000103',
    1,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    0,
    0,
    'training fixture'
  );
