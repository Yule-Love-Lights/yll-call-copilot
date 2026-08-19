begin;

select id
from public.transcripts
where id = '24000000-0000-4000-8000-000000000301'
for update;

-- The advisory lock is acquired only after the transcript row lock. Seeing it
-- therefore gives the CI driver a deterministic signal that session 2 must
-- block behind this transaction's finalization decision.
select pg_advisory_xact_lock(240024);

select pg_sleep(3);

select public.call_commitments_finalize_extraction(
  '24000000-0000-4000-8000-000000000301',
  '[{"kind":"send_quote","detail":"send the final quote","promised_at":null,"extraction_index":0}]'::jsonb,
  'concurrency-session-1'
);

commit;
