-- Apply after migration 0023 and before 0024. One transcript already has
-- commitments and one legitimately has none, proving that 0024 backfills only
-- evidence it can establish without inventing a completed extraction.

insert into public.transcripts (
  id,
  source_file,
  raw_text,
  outcome,
  metric_scope
) values
  (
    '24000000-0000-4000-8000-000000000101',
    'legacy-with-commitments.txt',
    'Rep promised a quote.',
    'unknown',
    'training'
  ),
  (
    '24000000-0000-4000-8000-000000000102',
    'legacy-without-commitments.txt',
    'No promises on this call.',
    'unknown',
    'training'
  );

insert into public.call_commitments (
  transcript_id,
  kind,
  detail,
  extraction_index,
  created_at
) values
  (
    '24000000-0000-4000-8000-000000000101',
    'send_quote',
    'send the quote',
    0,
    '2026-08-18T12:00:00Z'
  ),
  (
    '24000000-0000-4000-8000-000000000101',
    'send_info',
    'send warranty information',
    0,
    '2026-08-18T12:01:00Z'
  );
