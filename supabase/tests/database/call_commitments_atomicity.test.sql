begin;

create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;

select no_plan();

insert into public.transcripts (
  id,
  source_file,
  raw_text,
  outcome,
  metric_scope
) values
  (
    '24000000-0000-4000-8000-000000000001',
    'commitment-atomicity-1.txt',
    'Rep promised to send a quote.',
    'unknown',
    'performance'
  ),
  (
    '24000000-0000-4000-8000-000000000002',
    'commitment-atomicity-2.txt',
    'Rep promised to send information.',
    'unknown',
    'performance'
  );

select is(
  public.call_commitments_upsert_batch(
    '24000000-0000-4000-8000-000000000001',
    '[{"kind":"send_quote","detail":"send quote","promised_at":null,"extraction_index":0}]'::jsonb
  ),
  'ok',
  'the first commitment batch is accepted'
);

select is(
  public.call_commitments_upsert_batch(
    '24000000-0000-4000-8000-000000000001',
    '[{"kind":"send_quote","detail":"send the updated quote wording","promised_at":null,"extraction_index":0}]'::jsonb
  ),
  'ok',
  'replaying the same dedupe key is accepted idempotently'
);

select is(
  (
    select count(*)::integer
    from public.call_commitments
    where transcript_id = '24000000-0000-4000-8000-000000000001'
  ),
  1,
  'an idempotent replay does not duplicate the commitment'
);

select is(
  (
    select detail
    from public.call_commitments
    where transcript_id = '24000000-0000-4000-8000-000000000001'
  ),
  'send quote',
  'a compatibility retry cannot rewrite a finalized extraction'
);

update public.call_commitments
set status = 'cleared', cleared_at = now()
where transcript_id = '24000000-0000-4000-8000-000000000001';

select is(
  public.call_commitments_upsert_batch(
    '24000000-0000-4000-8000-000000000001',
    '[{"kind":"send_quote","detail":"must not overwrite","promised_at":null,"extraction_index":0},{"kind":"send_info","detail":"must not partially insert","promised_at":null,"extraction_index":0}]'::jsonb
  ),
  'ok',
  'a legacy retry after human resolution remains an idempotent no-op'
);

select is(
  (
    select detail
    from public.call_commitments
    where transcript_id = '24000000-0000-4000-8000-000000000001'
      and kind = 'send_quote'
  ),
  'send quote',
  'an idempotent compatibility retry does not overwrite the resolved row'
);

select is(
  (
    select count(*)::integer
    from public.call_commitments
    where transcript_id = '24000000-0000-4000-8000-000000000001'
  ),
  1,
  'an idempotent compatibility retry performs no partial insert'
);

select throws_ok(
  $$
    select public.call_commitments_upsert_batch(
      '24000000-0000-4000-8000-000000000002',
      '[{"kind":"send_info","detail":"valid first row","promised_at":null,"extraction_index":0},{"kind":"send_info","detail":"invalid second row","promised_at":null,"extraction_index":"not-an-integer"}]'::jsonb
    )
  $$,
  '22P02',
  null,
  'an invalid row aborts the database statement'
);

select is(
  (
    select count(*)::integer
    from public.call_commitments
    where transcript_id = '24000000-0000-4000-8000-000000000002'
  ),
  0,
  'a failed multi-row statement leaves no partial commitment behind'
);

select * from finish();
rollback;
