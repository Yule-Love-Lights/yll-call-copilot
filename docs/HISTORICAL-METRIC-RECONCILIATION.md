# Historical metric reconciliation

Migration `0020_lead_work_authorization.sql` intentionally stops when it finds
legacy metric-derived artifacts whose provenance cannot be established from the
database. This is not a migration defect. Those rows predate `metric_scope`, so
automatically calling them performance data would create unprovable employee
statistics.

This runbook is the safe repair path. It never relabels ambiguous history as
performance. Run it only against a restored staging copy first. A database
backup and a human review of every exported edited playbook are required before
the production transaction.

## 1. Read-only inventory

Run these queries before any write:

```sql
select 'weekly_digests' as artifact, count(*) from public.weekly_digests
union all
select 'brain_reviews', count(*) from public.brain_reviews
union all
select 'playbook_proposals', count(*) from public.playbook_proposals
union all
select 'edited_playbook_versions', count(*)
from public.playbook_versions where source = 'edited';

select
  vertical_record.id,
  vertical_record.slug,
  vertical_record.active_version,
  version_record.id as version_id,
  version_record.version,
  version_record.created_at,
  version_record.content
from public.verticals as vertical_record
join public.playbook_versions as version_record
  on version_record.vertical_id = vertical_record.id
where version_record.source = 'edited'
order by vertical_record.slug, version_record.version;
```

Run the exact ID-producing forms of both remaining `0020` preflights. The
personal-touch predicate below is the migration predicate, with only
`count(*)` replaced by the primary key required for review:

```sql
select touch_record.id
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
                  and coalesce(
                    ended_real_session.ended_at,
                    linked_call.ended_at
                  ) is not null
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
    else nullif(
      btrim(coalesce(transcript_record.source_file, '')),
      ''
    ) is not null
  end
order by touch_record.id;

select score_record.id, score_record.transcript_id
from public.call_scores as score_record
left join public.transcripts as transcript_record
  on transcript_record.id = score_record.transcript_id
where transcript_record.id is null
order by score_record.id;
```

Export every identified row by primary key. Do not export customer message
bodies or credentials into this repository.

## 2. Export outside the repository

Export these complete tables or row sets to an encrypted operator-controlled
location:

- `weekly_digests`
- `brain_reviews`
- `playbook_proposals`
- every `playbook_versions` row whose `source = 'edited'`
- every unsafe `second_mile_touches` row found by the preflight query
- every orphan `call_scores` row found by the preflight query
- the affected `verticals` rows

Record the backup identifier and row counts in the deployment ticket. Never
commit the exports because they can contain employee and customer information.

## 3. Human classification

For each edited playbook version, record whether it was:

1. a verified manual edit that should be recreated after migration `0020`, or
2. generated from the legacy proposal/review pipeline and therefore must stay
quarantined.

The current schema cannot determine this reliably. If the operator cannot prove
an edit was manual, classify it as quarantined. Save the approved manual content
outside the database so it can be recreated only after `0020` installs metric
provenance.

## 4. Transactional quarantine

Put the application in maintenance mode and pause every cron, worker, and
operator path that can write calls, transcripts, scores, touches, reviews,
digests, proposals, playbooks, or verticals. Keep those writers paused until
migration `0020` and its assertions finish. This prevents new unsafe rows from
appearing in the gap between this repair transaction and the migration.

Create two encrypted, operator-controlled CSV files containing one reviewed
UUID per line and no header:

- `/secure/operator-reviewed-unsafe-touch-ids.csv`
- `/secure/operator-reviewed-orphan-score-ids.csv`

An empty file is required when the corresponding query returned no rows. The
transaction below locks every source and target table, imports those reviewed
IDs, and compares both directions. It aborts before deletion if the live set
changed or the supplied set is incomplete or overbroad. Run it with `psql` so
the `\copy` commands execute on the operator's machine. Replace only the two
secure file paths when necessary.

```sql
begin;

set local lock_timeout = '5s';

lock table
  public.brain_reviews,
  public.call_scores,
  public.calls,
  public.live_sessions,
  public.playbook_proposals,
  public.playbook_versions,
  public.second_mile_touches,
  public.transcripts,
  public.verticals,
  public.weekly_digests
in access exclusive mode;

create temporary table reviewed_unsafe_touches (
  id uuid primary key
) on commit drop;

create temporary table reviewed_orphan_scores (
  id uuid primary key
) on commit drop;

\copy reviewed_unsafe_touches(id) from '/secure/operator-reviewed-unsafe-touch-ids.csv' with (format csv)
\copy reviewed_orphan_scores(id) from '/secure/operator-reviewed-orphan-score-ids.csv' with (format csv)

create temporary table current_unsafe_touches on commit drop as
select touch_record.id
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
                  and coalesce(
                    ended_real_session.ended_at,
                    linked_call.ended_at
                  ) is not null
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
    else nullif(
      btrim(coalesce(transcript_record.source_file, '')),
      ''
    ) is not null
  end;

create temporary table current_orphan_scores on commit drop as
select score_record.id
from public.call_scores as score_record
left join public.transcripts as transcript_record
  on transcript_record.id = score_record.transcript_id
where transcript_record.id is null;

do $reviewed_set_guard$
begin
  if exists (
    select id from current_unsafe_touches
    except
    select id from reviewed_unsafe_touches
  ) or exists (
    select id from reviewed_unsafe_touches
    except
    select id from current_unsafe_touches
  ) then
    raise exception 'Reviewed unsafe-touch IDs do not exactly match the locked live preflight set';
  end if;

  if exists (
    select id from current_orphan_scores
    except
    select id from reviewed_orphan_scores
  ) or exists (
    select id from reviewed_orphan_scores
    except
    select id from current_orphan_scores
  ) then
    raise exception 'Reviewed orphan-score IDs do not exactly match the locked live preflight set';
  end if;
end
$reviewed_set_guard$;

-- Derived summaries and proposals cannot be given positive provenance.
delete from public.weekly_digests;
delete from public.brain_reviews;
delete from public.playbook_proposals;

-- An active edited version must be moved to the newest retained generated
-- version before all legacy edited versions are quarantined.
update public.verticals as vertical_record
set active_version = (
  select max(generated.version)
  from public.playbook_versions as generated
  where generated.vertical_id = vertical_record.id
    and generated.source = 'generated'
)
where exists (
  select 1
  from public.playbook_versions as active_edited
  where active_edited.vertical_id = vertical_record.id
    and active_edited.version = vertical_record.active_version
    and active_edited.source = 'edited'
)
and exists (
  select 1
  from public.playbook_versions as generated
  where generated.vertical_id = vertical_record.id
    and generated.source = 'generated'
);

-- Fail instead of deleting when an affected vertical has no generated
-- fallback. Resolve that vertical manually and rerun the transaction.
do $guard$
begin
  if exists (
    select 1
    from public.verticals as vertical_record
    join public.playbook_versions as active_edited
      on active_edited.vertical_id = vertical_record.id
      and active_edited.version = vertical_record.active_version
      and active_edited.source = 'edited'
  ) then
    raise exception 'An active edited playbook has no retained generated fallback';
  end if;
end
$guard$;

delete from public.playbook_versions where source = 'edited';

delete from public.second_mile_touches as touch_record
using reviewed_unsafe_touches as reviewed
where touch_record.id = reviewed.id;

delete from public.call_scores as score_record
using reviewed_orphan_scores as reviewed
where score_record.id = reviewed.id;

-- Every reviewed legacy artifact class must now be empty.
do $verify$
begin
  if (select count(*) from public.weekly_digests) <> 0
    or (select count(*) from public.brain_reviews) <> 0
    or (select count(*) from public.playbook_proposals) <> 0
    or (select count(*) from public.playbook_versions where source = 'edited') <> 0
    or exists (
      select 1
      from public.second_mile_touches as touch_record
      left join public.transcripts as transcript_record
        on transcript_record.id::text = nullif(
          btrim(touch_record.payload ->> 'transcript_id'),
          ''
        )
      where touch_record.kind = 'personal_touch'
        and touch_record.id in (select id from current_unsafe_touches)
    )
    or exists (
      select 1
      from public.call_scores as score_record
      left join public.transcripts as transcript_record
        on transcript_record.id = score_record.transcript_id
      where transcript_record.id is null
    )
  then
    raise exception 'A reviewed legacy metric artifact remains after quarantine';
  end if;
end
$verify$;

commit;
```

Have a second person compare both CSV files with the encrypted exports before
execution. Do not resume writers after this commit. Apply `0020` immediately.

## 5. Prove and migrate

1. With writers still paused, re-run all three inventory/preflight queries in
   section 1. The four legacy artifact counts and both ID result sets must be
   empty.
2. Apply migration `0020` through the normal migration runner immediately.
3. Run `select public.assert_legacy_metric_artifacts_reconciled();` and
   `select public.assert_personal_touch_metric_provenance();`.
4. Recreate only the manually verified playbook edits through the post-`0020`
   application path. Do not restore reviews, digests, proposals, or unsafe
   personal-touch rows from the archive.
5. Compare the staging and production row counts with the deployment ticket.
6. Resume writers only after all assertions and counts pass.

## Rollback

Before `commit`, use `rollback`. After commit, restore the backup into a new
database and investigate there. Do not blindly reinsert the exports into the
live database, because doing so reintroduces the exact provenance failure this
procedure removes.
