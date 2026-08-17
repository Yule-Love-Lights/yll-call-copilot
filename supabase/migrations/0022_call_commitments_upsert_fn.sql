-- #217 review MEDIUM (TOCTOU): persist.ts's original guard did a SELECT of
-- existing statuses, decided in application code, then a separate UPSERT --
-- two round trips, no transaction. A verification job (slice 3) setting a
-- row's status between those two calls reproduces the exact mislabeling bug
-- the guard was written to prevent, just moved into the gap between the two
-- calls instead of eliminated.
--
-- Fix: move the check-then-write into ONE database function, invoked via
-- RPC, so it is one statement's worth of atomicity instead of two
-- application round trips. The function locks every existing row for the
-- transcript with `for update` before deciding -- if a concurrent
-- transaction (the verify job) is mid-update on one of those rows, this
-- function's SELECT blocks until that transaction commits and then sees
-- the real (post-update) status; if this function's SELECT locks first,
-- the verify job's UPDATE blocks until THIS function's transaction commits.
-- Either ordering resolves correctly -- there is no window between the
-- check and the write where a third party can slip a status change in,
-- because both operations are inside the same transaction and the lock is
-- held across both.
--
-- security definer + a locked-down search_path: the function needs to
-- write to call_commitments as the owning role regardless of the caller's
-- privileges (mirrors why 0019's default-deny leaves only service_role
-- with table access) -- callers reach this exclusively through
-- service_role's RPC grant below, never directly.

create or replace function call_commitments_upsert_batch(
  p_transcript_id uuid,
  p_rows jsonb
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_resolved boolean;
begin
  -- Lock every existing row for this transcript (not just already-resolved
  -- ones) -- an OPEN row must also be locked here, or a concurrent
  -- transition of that same row from 'open' to 'cleared' could still race
  -- past this check undetected.
  select bool_or(locked.status <> 'open')
  into v_has_resolved
  from (
    select status
    from call_commitments
    where transcript_id = p_transcript_id
    for update
  ) as locked;

  if coalesce(v_has_resolved, false) then
    return 'refused';
  end if;

  insert into call_commitments (
    transcript_id, ghl_contact_id, rep_email, kind, detail, promised_at, extraction_index
  )
  select
    p_transcript_id,
    r->>'ghl_contact_id',
    r->>'rep_email',
    r->>'kind',
    r->>'detail',
    (r->>'promised_at')::timestamptz,
    (r->>'extraction_index')::int
  from jsonb_array_elements(p_rows) as r
  on conflict (transcript_id, kind, extraction_index)
  do update set
    ghl_contact_id = excluded.ghl_contact_id,
    rep_email = excluded.rep_email,
    detail = excluded.detail,
    promised_at = excluded.promised_at;

  return 'ok';
end;
$$;

revoke all on function call_commitments_upsert_batch(uuid, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function call_commitments_upsert_batch(uuid, jsonb)
  to service_role;
