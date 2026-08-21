-- Template only. Generate protected executable SQL with
-- scripts/prepare-0020-recording-release.mjs.
\set ON_ERROR_STOP on

begin;

set local lock_timeout = '5s';

lock table public.call_recordings in access exclusive mode;

create temporary table reviewed_canary_ids (id uuid primary key) on commit drop;
create temporary table reviewed_remainder_ids (id uuid primary key) on commit drop;

copy reviewed_canary_ids(id) from stdin;
__REVIEWED_CANARY_IDS__
\.
copy reviewed_remainder_ids(id) from stdin;
__REVIEWED_REMAINDER_IDS__
\.

do $remainder_plan_guard$
begin
  if (select count(*) from reviewed_canary_ids) <> 3
    or (select count(*) from reviewed_remainder_ids) <> 16
  then
    raise exception 'Reviewed recording release files must contain exactly 3 canary and 16 remainder IDs';
  end if;

  if exists (
    select id from reviewed_canary_ids
    intersect
    select id from reviewed_remainder_ids
  ) then
    raise exception 'Reviewed canary and remainder recording IDs overlap';
  end if;

  if exists (
    select id from reviewed_canary_ids
    except
    select id from public.call_recordings
    where status = 'transcribed'
      and skip_reason = 'released_0020_canary'
  ) or exists (
    select id from public.call_recordings
    where skip_reason = 'released_0020_canary'
    except
    select id from reviewed_canary_ids
  ) then
    raise exception 'All 3 reviewed canaries must be transcribed before remainder release';
  end if;

  if exists (
    select id from reviewed_remainder_ids
    except
    select id from public.call_recordings
    where status = 'skipped'
      and skip_reason = 'held_migration_0020'
  ) or exists (
    select id from public.call_recordings
    where status = 'skipped'
      and skip_reason = 'held_migration_0020'
    except
    select id from reviewed_remainder_ids
  ) then
    raise exception 'Reviewed remainder IDs do not exactly match the locked held set';
  end if;

  if exists (
    select 1
    from public.call_recordings
    where skip_reason = 'released_0020_remainder'
      or detail ->> 'ops_migration_release_batch' = '0020_remainder'
  ) then
    raise exception 'A remainder release marker already exists; inspect state instead of replaying';
  end if;

  if exists (
    select 1
    from public.call_recordings
    where status = 'pending'
      or (
        status = 'processing'
        and processing_at < clock_timestamp() - interval '15 minutes'
      )
  ) then
    raise exception 'Unreviewed pending or stale-processing recordings are eligible; remainder release is blocked';
  end if;
end
$remainder_plan_guard$;

do $release_remainder$
declare
  v_released bigint;
begin
  update public.call_recordings as recording
  set status = 'pending',
      skip_reason = 'released_0020_remainder',
      processing_at = null,
      detail = jsonb_set(
        coalesce(recording.detail, '{}'::jsonb),
        '{ops_migration_release_batch}',
        '"0020_remainder"'::jsonb,
        true
      )
  from reviewed_remainder_ids as reviewed
  where recording.id = reviewed.id
    and recording.status = 'skipped'
    and recording.skip_reason = 'held_migration_0020'
  ;
  get diagnostics v_released = row_count;
  if v_released <> 16 then
    raise exception 'Remainder release count mismatch (expected=16, released=%)', v_released;
  end if;
end
$release_remainder$;

do $remainder_postcondition$
begin
  if exists (
    select recording.id
    from public.call_recordings as recording
    where recording.status = 'pending'
      or (
        recording.status = 'processing'
        and recording.processing_at < clock_timestamp() - interval '15 minutes'
      )
    except
    select id from reviewed_remainder_ids
  ) or exists (
    select id from reviewed_remainder_ids
    except
    select recording.id
    from public.call_recordings as recording
    where recording.status = 'pending'
      and recording.skip_reason = 'released_0020_remainder'
      and recording.detail ->> 'ops_migration_release_batch' = '0020_remainder'
  ) then
    raise exception 'The reviewed remainder is not the exact eligible recording-worker set';
  end if;
end
$remainder_postcondition$;

commit;
