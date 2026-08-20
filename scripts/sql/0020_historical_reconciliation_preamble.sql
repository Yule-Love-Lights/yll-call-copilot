-- Generated-driver preamble. Never execute this file by itself.
-- scripts/prepare-0020-hosted-apply.mjs replaces the manifest marker below
-- and places this preamble inside the same transaction as canonical 0020-0024.

select pg_advisory_xact_lock(202608200020);

set local lock_timeout = '5s';

lock table
  public.verticals,
  public.brain_reviews,
  public.playbook_proposals,
  public.playbook_versions,
  public.transcripts,
  public.calls,
  public.live_sessions,
  public.call_scores,
  public.feedback_cards,
  public.second_mile_touches,
  public.weekly_digests
in share row exclusive mode;

create temporary table reviewed_metric_artifacts (
  artifact_class text not null check (
    artifact_class in (
      'weekly_digest',
      'brain_review',
      'playbook_proposal',
      'edited_playbook_version',
      'unsafe_personal_touch',
      'orphan_call_score'
    )
  ),
  id uuid not null,
  primary key (artifact_class, id)
) on commit drop;

copy reviewed_metric_artifacts (artifact_class, id)
from stdin with (format csv, header true);
__REVIEWED_ARTIFACT_MANIFEST__
\.

create temporary table current_metric_artifacts (
  artifact_class text not null,
  id uuid not null,
  primary key (artifact_class, id)
) on commit drop;

insert into current_metric_artifacts (artifact_class, id)
select 'weekly_digest', id from public.weekly_digests
union all
select 'brain_review', id from public.brain_reviews
union all
select 'playbook_proposal', id from public.playbook_proposals
union all
select 'edited_playbook_version', id
from public.playbook_versions
where source = 'edited'
union all
select 'unsafe_personal_touch', touch_record.id
from public.second_mile_touches as touch_record
left join public.transcripts as transcript_record
  on transcript_record.id::text = nullif(
    btrim(touch_record.payload ->> 'transcript_id'),
    ''
  )
where touch_record.kind = 'personal_touch'
  and not case
    when transcript_record.id is null then false
    when exists (
      select 1
      from public.calls as linked_call
      where linked_call.transcript_id = transcript_record.id
    ) then not exists (
      select 1
      from public.calls as linked_call
      where linked_call.transcript_id = transcript_record.id
        and not (
          not exists (
            select 1
            from public.live_sessions as simulator_session
            where simulator_session.call_id = linked_call.id
              and simulator_session.mode = 'simulator'
          )
          and (
            (
              exists (
                select 1
                from public.live_sessions as any_real_session
                where any_real_session.call_id = linked_call.id
                  and any_real_session.mode = 'twilio'
              )
              and exists (
                select 1
                from public.live_sessions as ended_real_session
                where ended_real_session.call_id = linked_call.id
                  and ended_real_session.mode = 'twilio'
                  and ended_real_session.dial_started_at is not null
                  and coalesce(ended_real_session.ended_at, linked_call.ended_at) is not null
              )
              and linked_call.outcome is not null
            )
            or (
              not exists (
                select 1
                from public.live_sessions as any_real_session
                where any_real_session.call_id = linked_call.id
                  and any_real_session.mode = 'twilio'
              )
              and linked_call.outcome is not null
              and linked_call.ended_at is not null
            )
          )
        )
    )
    else nullif(btrim(coalesce(transcript_record.source_file, '')), '') is not null
  end
union all
select 'orphan_call_score', score_record.id
from public.call_scores as score_record
left join public.transcripts as transcript_record
  on transcript_record.id = score_record.transcript_id
where transcript_record.id is null;

do $reviewed_manifest_guard$
begin
  if exists (
    select artifact_class, id from current_metric_artifacts
    except
    select artifact_class, id from reviewed_metric_artifacts
  ) or exists (
    select artifact_class, id from reviewed_metric_artifacts
    except
    select artifact_class, id from current_metric_artifacts
  ) then
    raise exception 'Reviewed artifact manifest does not exactly match the locked six-class live set';
  end if;
end
$reviewed_manifest_guard$;

create temporary table reviewed_orphan_feedback_cards on commit drop as
select feedback.id
from public.feedback_cards as feedback
join reviewed_metric_artifacts as reviewed
  on reviewed.artifact_class = 'orphan_call_score'
  and reviewed.id = feedback.call_score_id;

create temporary table reviewed_active_edited_fallbacks on commit drop as
select
  vertical_record.id as vertical_id,
  max(generated.version) as fallback_version
from public.verticals as vertical_record
join public.playbook_versions as active_edited
  on active_edited.vertical_id = vertical_record.id
  and active_edited.version = vertical_record.active_version
join reviewed_metric_artifacts as reviewed
  on reviewed.artifact_class = 'edited_playbook_version'
  and reviewed.id = active_edited.id
left join public.playbook_versions as generated
  on generated.vertical_id = vertical_record.id
  and generated.source = 'generated'
group by vertical_record.id;

do $fallback_guard$
begin
  if exists (
    select 1
    from reviewed_active_edited_fallbacks
    where fallback_version is null
  ) then
    raise exception 'An active reviewed edited playbook has no retained generated fallback';
  end if;
end
$fallback_guard$;

do $fallback_update$
declare
  v_expected bigint;
  v_updated bigint;
begin
  select count(*) into v_expected from reviewed_active_edited_fallbacks;
  update public.verticals as vertical_record
  set active_version = fallback.fallback_version
  from reviewed_active_edited_fallbacks as fallback
  where fallback.vertical_id = vertical_record.id;
  get diagnostics v_updated = row_count;
  if v_updated <> v_expected then
    raise exception 'Edited-playbook fallback update count mismatch (expected=%, updated=%)',
      v_expected,
      v_updated;
  end if;
end
$fallback_update$;

do $delete_reviewed_artifacts$
declare
  v_expected bigint;
  v_deleted bigint;
begin
  select count(*) into v_expected from reviewed_orphan_feedback_cards;
  delete from public.feedback_cards as artifact
  using reviewed_orphan_feedback_cards as reviewed
  where artifact.id = reviewed.id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> v_expected then
    raise exception 'Orphan-score feedback-card delete count mismatch';
  end if;

  select count(*) into v_expected from reviewed_metric_artifacts
  where artifact_class = 'weekly_digest';
  delete from public.weekly_digests as artifact
  using reviewed_metric_artifacts as reviewed
  where reviewed.artifact_class = 'weekly_digest' and artifact.id = reviewed.id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> v_expected then raise exception 'Weekly-digest delete count mismatch'; end if;

  select count(*) into v_expected from reviewed_metric_artifacts
  where artifact_class = 'brain_review';
  delete from public.brain_reviews as artifact
  using reviewed_metric_artifacts as reviewed
  where reviewed.artifact_class = 'brain_review' and artifact.id = reviewed.id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> v_expected then raise exception 'Brain-review delete count mismatch'; end if;

  select count(*) into v_expected from reviewed_metric_artifacts
  where artifact_class = 'playbook_proposal';
  delete from public.playbook_proposals as artifact
  using reviewed_metric_artifacts as reviewed
  where reviewed.artifact_class = 'playbook_proposal' and artifact.id = reviewed.id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> v_expected then raise exception 'Playbook-proposal delete count mismatch'; end if;

  select count(*) into v_expected from reviewed_metric_artifacts
  where artifact_class = 'edited_playbook_version';
  delete from public.playbook_versions as artifact
  using reviewed_metric_artifacts as reviewed
  where reviewed.artifact_class = 'edited_playbook_version' and artifact.id = reviewed.id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> v_expected then raise exception 'Edited-playbook delete count mismatch'; end if;

  select count(*) into v_expected from reviewed_metric_artifacts
  where artifact_class = 'unsafe_personal_touch';
  delete from public.second_mile_touches as artifact
  using reviewed_metric_artifacts as reviewed
  where reviewed.artifact_class = 'unsafe_personal_touch' and artifact.id = reviewed.id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> v_expected then raise exception 'Unsafe-touch delete count mismatch'; end if;

  select count(*) into v_expected from reviewed_metric_artifacts
  where artifact_class = 'orphan_call_score';
  delete from public.call_scores as artifact
  using reviewed_metric_artifacts as reviewed
  where reviewed.artifact_class = 'orphan_call_score' and artifact.id = reviewed.id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> v_expected then raise exception 'Orphan-score delete count mismatch'; end if;
end
$delete_reviewed_artifacts$;

do $reconciliation_postcondition$
begin
  if exists (
    select 1
    from reviewed_metric_artifacts as reviewed
    join public.weekly_digests as artifact on artifact.id = reviewed.id
    where reviewed.artifact_class = 'weekly_digest'
  ) or exists (
    select 1
    from reviewed_metric_artifacts as reviewed
    join public.brain_reviews as artifact on artifact.id = reviewed.id
    where reviewed.artifact_class = 'brain_review'
  ) or exists (
    select 1
    from reviewed_metric_artifacts as reviewed
    join public.playbook_proposals as artifact on artifact.id = reviewed.id
    where reviewed.artifact_class = 'playbook_proposal'
  ) or exists (
    select 1
    from reviewed_metric_artifacts as reviewed
    join public.playbook_versions as artifact on artifact.id = reviewed.id
    where reviewed.artifact_class = 'edited_playbook_version'
  ) or exists (
    select 1
    from reviewed_metric_artifacts as reviewed
    join public.second_mile_touches as artifact on artifact.id = reviewed.id
    where reviewed.artifact_class = 'unsafe_personal_touch'
  ) or exists (
    select 1
    from reviewed_metric_artifacts as reviewed
    join public.call_scores as artifact on artifact.id = reviewed.id
    where reviewed.artifact_class = 'orphan_call_score'
  ) or exists (
    select 1
    from reviewed_orphan_feedback_cards as reviewed
    join public.feedback_cards as artifact on artifact.id = reviewed.id
  ) then
    raise exception 'A reviewed metric artifact remains after keyed reconciliation';
  end if;
end
$reconciliation_postcondition$;
