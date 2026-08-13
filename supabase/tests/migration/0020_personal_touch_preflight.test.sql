begin;

create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;

select plan(3);

select hasnt_column(
  'public',
  'calls',
  'metric_scope',
  'personal-touch preflight stops migration before calls DDL'
);

select hasnt_column(
  'public',
  'transcripts',
  'metric_scope',
  'personal-touch preflight stops migration before transcript DDL'
);

select is(
  (
    select count(*)::bigint
    from public.second_mile_touches
    where kind = 'personal_touch'
      and payload ->> 'transcript_id' =
        '81000000-0000-0000-0000-000000000101'
  ),
  1::bigint,
  'the blocked legacy task remains available for explicit operator reconciliation'
);

select * from finish();
rollback;
