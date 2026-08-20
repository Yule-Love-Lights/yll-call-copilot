# Hosted migration runbook: 0017 → 0024

Status: **0017 and 0018 applied to the hosted project; 0019 → 0024 pending**
Date: 2026-08-20
Project: `mjmociuxxxwxvasnpxav` (Supabase, `us-east-2`, PostgreSQL 17.6.1.141)

This runbook covers a specific, measured situation: eight migrations were
checked in and their calling code deployed, but none had been applied to the
hosted database. It does not supersede `PHASE-0-RLS-RUNBOOK.md` — section 4 of
that document still governs 0019, and its remaining steps are reproduced here.

## 1. Why the pipeline was failing

`supabase_migrations.schema_migrations` was empty and the `public` schema had
**zero** functions, so deployed code was calling routines that did not exist.

Two distinct failure modes were measured in `call_recordings` (440 rows):

| Cause | Rows | Deepgram billed |
| --- | --- | --- |
| `PGRST204: Could not find the 'metric_scope' column of 'transcripts'` | 24 | **Yes** — transcription completed, the insert failed |
| `GHL 422: Message does not have recording` | 42 | No — download failed first |
| `Deepgram transcription request failed: "timeout"` | 2 | Probably not |

Only the first class is migration-caused, and it stopped on its own at
**18:07:51 UTC on 2026-08-19**. The reason matters: once the deploy carrying
`advance_recording_sync_cursor` (migration 0024) went out, the cron began
throwing at that missing RPC in `src/app/api/cron/sync-recordings/route.ts`
*before* reaching `processPendingRecordings`. Deepgram is no longer being
called at all. The 19 rows inserted at 22:05 sit at `status = 'pending'` with
`processing_at IS NULL`, which is the signature of that early throw.

**The pipeline resumes for real when 0024 lands.** Because 0020 adds
`metric_scope` earlier in the order, there is no window where the RPC exists
without the column — so resumption is correct behavior, not a fresh burn. Pause
the cron first only if you want to choose that moment deliberately.

The cursor is also stuck: `recording_sync_state.last_synced_at` reads
`2026-08-08 18:48:27.5+00` with `{"messages_seen": 500, "inserted": 0,
"truncated": true}`. That is the GHL `offset` paging bug and is **out of scope
here** — it needs `startAfterDate` paging verified against live GHL.

## 2. Already applied

Both were additive and are verified in place:

- **0017** `live_dial_grants` — 7 columns on `live_sessions`, the
  `live_dial_grant_shape` constraint, 2 partial indexes. All 3 existing rows are
  `mode='twilio', status='ended'` and satisfy the constraint's third arm.
- **0018** `webhook_idempotency` — `events_log.source_event_key` plus its
  partial unique index. `events_log` is empty.

## 3. The 0020 decision

0020's first statement is a preflight that aborts when legacy metric artifacts
exist, and its message instructs the operator to delete them. Live counts:

| Table | Rows |
| --- | --- |
| `weekly_digests` | 5 |
| `brain_reviews` | 9 |
| `playbook_proposals` | 14 |
| `playbook_versions` where `source='edited'` | 0 |

**Chosen path: export and skip the gate, keep the 28 rows.** This is safe
because those four tables are referenced *only* inside 0019's default-deny name
list and 0020's own preflight and assertion bodies. No statement in 0017–0024
alters, drops, or backfills them, so the resulting schema is identical either
way. The export is at `0020-preflight-artifacts-backup.json` (28 rows plus the
4 `verticals` rows needed to reset `active_version`).

Two consequences to accept knowingly:

1. `public.assert_legacy_metric_artifacts_reconciled()` is still created and
   still raises while those rows exist. `supabase/tests/database/lead_work_authorization.test.sql`
   asserts that behavior, so **the DB test suite stays red** until the artifacts
   are quarantined or given provenance. That is a deferred question, not a
   solved one.
2. Reporting that mixes these 28 pre-provenance artifacts with post-0020
   `metric_scope = 'performance'` data remains suspect.

**Do not hand-add `metric_scope`.** Lines 218, 222, and 225 of 0020 use bare
`add column metric_scope text` with no `if not exists`; a pre-added column makes
the migration fail.

0020's **second** preflight (`$legacy_personal_touch_provenance_preflight$`) is
left fully armed. Measured against live data after 0017 it returns
`unsafe_personal_touches = 0`, so it passes on its own merits and removing it
would disarm a real check for nothing.

## 4. Apply order

Run from a checkout where the files are read byte-for-byte — the Supabase CLI
or `psql`, not a copy-paste path. Order is strict: 0020 must precede 0024 so
`metric_scope` exists before the cron's cursor RPC does.

```sh
# 0. Snapshot first. PHASE-0-RLS-RUNBOOK.md section 4 step 4 is not optional
#    and there is no existing backup of this database.
pg_dump "$SUPABASE_DB_URL" -Fc -f yll-call-copilot-$(date +%Y%m%d-%H%M).dump

# 1. Generate the 0020 variant (derived from the reviewed file, never retyped).
node scripts/prepare-0020-hosted-apply.mjs /tmp/0020_hosted_apply.sql

# 2. Apply in order.
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0019_existing_tables_default_deny.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -f /tmp/0020_hosted_apply.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0021_call_commitments.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0022_call_commitments_upsert_fn.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0023_operations_hub_identity_foundation.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0024_commitment_extraction_tracking.sql
```

`0019` is the RLS default-deny boundary and `PHASE-0-RLS-RUNBOOK.md` still
carries `Status: hosted rollout not yet authorized`. Its own guards were
verified to pass (`current_user = postgres`, `service_role` has `BYPASSRLS`,
`anon` and `authenticated` both exist, 31 tables with RLS on and 0 policies),
but it needs the human authorization that document requires before it runs.

Its section 4 also asks for a staging clone with current-state data and the
pgTAP suite plus sign-in, Office read/write, cron, HighLevel, Twilio, and
live-bridge smokes between steps 5 and 7. None of that has been done.

## 5. After applying

```sql
-- Expect metric_scope on leads/calls/transcripts/call_scores/live_sessions/followups
select table_name from information_schema.columns
where table_schema='public' and column_name='metric_scope' order by 1;

-- Expect advance_recording_sync_cursor to exist
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and proname='advance_recording_sync_cursor';

-- The 28 artifacts must still be here
select (select count(*) from weekly_digests) as digests,
       (select count(*) from brain_reviews) as reviews,
       (select count(*) from playbook_proposals) as proposals;
```

Then watch the first cron run at `:05`. The 19 pending rows will process; each
is a real Deepgram call, so confirm they land as `transcribed` rather than
`failed` before letting the backlog drain further.

## 6. Follow-ups this runbook does not close

- The 28 legacy artifacts need quarantine or provenance; until then
  `assert_legacy_metric_artifacts_reconciled()` and the DB test suite stay red.
- The GHL `offset` paging bug — cursor pinned at 2026-08-08, 500 seen / 21
  unique. Needs `startAfterDate` paging verified against live GHL.
- 24 recordings failed after a paid transcription and nothing retries a failed
  row; they need a deliberate re-drive once `metric_scope` exists.
- 42 rows failed with GHL 422 "Message does not have recording" and will fail
  again on any retry. They are not migration-related.
