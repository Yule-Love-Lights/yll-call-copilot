begin;

select id
from public.transcripts
where id = '24000000-0000-4000-8000-000000000302'
for update;

select pg_advisory_xact_lock(240025);
select pg_sleep(3);

select public.record_commitment_extraction_failure(
  '24000000-0000-4000-8000-000000000302',
  'deterministic_extraction_failed'
);

commit;
