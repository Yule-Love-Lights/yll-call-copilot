# Runbook — copilot migrations 0019 → 0024 (S60, 2026-08-19)

## Why this exists

The deployed copilot app is running **ahead of its database**. Two independent
consequences, both live:

1. `transcripts.metric_scope` does not exist, so every Deepgram transcription
   that succeeds then fails on insert (`PGRST204`). **24 recordings** died this
   way — roughly 119 minutes of paid Deepgram audio, discarded. Nothing retries
   a failed row.
2. `public.advance_recording_sync_cursor(timestamptz, jsonb)` does not exist,
   but `src/app/api/cron/sync-recordings/route.ts` calls it via `supabase.rpc`.
   Every cron run therefore inserts rows, throws at the RPC, and returns 500
   **before** reaching `processPendingRecordings`. That is why nothing has
   transcribed since 2026-08-07 and why the sync cursor is frozen at
   2026-08-08 18:48.

Corroboration for (2): `recording_sync_state.detail` contains the key
`cursor_held`, which the current code never writes, and lacks `upsert_failed`,
`stop_reason`, and `visibility_overlap_hours`, which it always writes. The
deployed code has never completed a successful run.

## Applied-state (detected from the live schema, not from a ledger)

`supabase_migrations` is **empty for all 24 migrations** — every migration to
date was applied out-of-band. State must be read from the schema.

| Migration | State | Detection |
|---|---|---|
| 0017 | applied (pre-S60) | 7/7 `live_sessions.dial_*` / `media_stream_*` columns |
| 0018 | applied (pre-S60) | `events_log.source_event_key` |
| 0019 | **applied in S60** | force-RLS 31/31, 0 anon grants, anon lost schema usage |
| 0020 | not applied | `transcripts.metric_scope` absent, `live_segments` absent |
| 0021 | not applied | `call_commitments` absent |
| 0022 | not applied | `call_commitments_upsert_batch` absent |
| 0023 | not applied | no `ops_*` tables |
| 0024 | not applied | `advance_recording_sync_cursor` absent |

Do **not** use `supabase db push` — a partial ledger would make it try to
re-apply 0001–0018. Apply with `psql -f` and leave the ledger alone, or
backfill the ledger for all 24 in one deliberate step first.

## Backup

Schema `backup_s60_20260819` holds a snapshot of all 31 public tables
(9,008 kB), verified equal to source table-by-table by a block that raises on
any count mismatch. **It lives in the same database**, so it protects against a
bad migration but not against losing the project. Take an off-box dump too:

```powershell
$url = (Get-Content .env.local | Select-String '^SUPABASE_DB_URL=(.+)$').Matches[0].Groups[1].Value
& 'C:\Program Files\PostgreSQL\17\bin\pg_dump.exe' $url -Fc -f "copilot-$(Get-Date -f yyyyMMdd-HHmm).dump"
```

## The one deviation: 0020's first preflight

0020 opens with `do $legacy_metric_artifact_preflight$` (lines 20–56). It counts
four tables and aborts if any is non-empty. Live counts:

| | count |
|---|---|
| `weekly_digests` | 5 |
| `brain_reviews` | 9 |
| `playbook_proposals` | 14 |
| `playbook_versions where source='edited'` | **0** |

The migration's own error text says to **delete** those 28 rows of real content.
That is unnecessary. Verified by reading the whole file:

- Those four tables appear **only** inside this preflight block and inside the
  permanent function `assert_legacy_metric_artifacts_reconciled()` (line 146).
  No DDL, no `update`, no `delete` touches them.
- The only two `verticals` references (lines 2224, 2705) are read-only
  `select`s inside new function bodies, not migration-time statements.
- Because `edited_playbook_versions = 0`, the error text's instruction to
  "reset each affected `vertical.active_version`" is moot — nothing is removed.

So: **skip that block, keep the rest, and all 28 rows survive untouched.**
Use `supabase/apply/0020_APPLY_S60_skip_legacy_artifact_preflight.sql`, which is
byte-identical to the original except that lines 20–56 are commented out
(3,430 lines both; exactly 37 lines changed; 7 balanced dollar-quote pairs).

**The other five preflights in 0020 all pass on current data** and are retained
unmodified:

| Preflight | Live result |
|---|---|
| personal-touch provenance | 0 unsafe (of 60 `personal_touch` rows) |
| legacy dial evidence | 0 |
| active Twilio sessions | 0 |
| multi-session calls | 0 |
| duplicate follow-up kinds | 0 |
| linked transcript scope conflict | 0 |
| orphan `call_scores` | 0 |

### Known consequence

`assert_legacy_metric_artifacts_reconciled()` is created by 0020 and encodes the
same rule. While those 28 rows exist it will raise if called. Nothing calls it
today, but pgTAP and any future deploy check will trip on it. Decide later
whether to reconcile the rows or relax the assertion — it is a tripwire, not a
blocker.

## Apply

Run from the repo root, in order, stopping on the first error.

```powershell
$url = (Get-Content .env.local | Select-String '^SUPABASE_DB_URL=(.+)$').Matches[0].Groups[1].Value
$psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'

& $psql $url -v ON_ERROR_STOP=1 -1 -f supabase\apply\0020_APPLY_S60_skip_legacy_artifact_preflight.sql
& $psql $url -v ON_ERROR_STOP=1 -1 -f supabase\migrations\0021_call_commitments.sql
& $psql $url -v ON_ERROR_STOP=1 -1 -f supabase\migrations\0022_call_commitments_upsert_fn.sql
& $psql $url -v ON_ERROR_STOP=1 -1 -f supabase\migrations\0023_operations_hub_identity_foundation.sql
& $psql $url -v ON_ERROR_STOP=1 -1 -f supabase\migrations\0024_commitment_extraction_tracking.sql
```

`-1` wraps each file in a single transaction so a failure leaves nothing
half-applied. 0019 is already applied — do not re-run it.

## Verify (expect every column `true` / non-zero)

```sql
select
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='transcripts' and column_name='metric_scope') = 1 as m0020_metric_scope,
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name='live_segments') = 1                            as m0020_live_segments,
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name='call_commitments') = 1                         as m0021,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='call_commitments_upsert_batch') = 1                 as m0022,
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name like 'ops_%') >= 5                               as m0023,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='advance_recording_sync_cursor') = 1                 as m0024,
  (select count(*) from public.weekly_digests)     = 5                                           as digests_intact,
  (select count(*) from public.brain_reviews)      = 9                                           as reviews_intact,
  (select count(*) from public.playbook_proposals) = 14                                          as proposals_intact;
```

## Then: release the parked recordings

19 recordings were parked in S60 to stop the Deepgram burn while the schema was
broken. They are inert but intact. Release them **only after 0020 and 0024 are
verified above**:

```sql
update public.call_recordings
set status = 'pending',
    skip_reason = null
where skip_reason = 'held_migration_0020';   -- expect exactly 19 rows
```

Then let the hourly cron drain them at `RECORDING_BATCH_SIZE = 6` per run, and
confirm they land as `transcribed` rather than `failed`.

## Rollback

Per-file rollback is `psql -1`, which already aborts a failed file cleanly. To
restore data from the snapshot:

```sql
begin;
truncate public.<table>;
insert into public.<table> select * from backup_s60_20260819.<table>;
commit;
```

## Still open after this

The GHL `offset` paging bug is real and independent: one run measured 500
messages seen, 21 unique, cursor stuck. It needs `startAfterDate` paging
verified against live GHL. A previous attempt was written and reverted when its
test hung — do not re-ship it unverified.
