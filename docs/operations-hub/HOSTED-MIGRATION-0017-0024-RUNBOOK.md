# Hosted migration runbook: 0017 to 0024

Status: **production blocked pending staging rehearsal**
Date: 2026-08-20
Project: `mjmociuxxxwxvasnpxav` (Supabase, `us-east-2`, PostgreSQL 17.6.1.141)
Hosted state: **0017 and 0018 ledger-applied; 0019 schema-applied out of band;
0020 to 0024 absent**
Staging: `yll-ops-hub-staging` (`ewbtkrytrnerypdkuimd`) exists with the clean
`0001` through `0024` target verified; the sanitized production-shaped
rehearsal remains pending

This runbook covers the measured hosted state. It does not supersede
`PHASE-0-RLS-RUNBOOK.md`. That runbook's staging, backup, smoke, and production
gates remain mandatory. Do not apply this procedure to production until the
entire procedure passes against a sanitized staging copy of the current state.

## 1. Measured hosted state

`supabase_migrations.schema_migrations` contains only these rows:

- `20260819235532 / 0017_live_dial_grants`
- `20260820001714 / 0018_webhook_idempotency`

Migration 0019 is visible in the schema but absent from that ledger. All 31
public tables have RLS enabled and forced, `anon` lacks public-schema usage,
and `anon` has no public-table grants. Migrations 0020 through 0024 are absent:
`transcripts.metric_scope`, `call_commitments`, the five `ops_*` tables, and
`advance_recording_sync_cursor` do not exist. Do not use `supabase db push`
against this mixed history.

The same-project `backup_s60_20260819` schema contains 31 snapshot tables whose
row counts matched public on 2026-08-20. It is a recovery aid, not an off-box
backup.

The legacy metric preflight currently finds:

- 5 `weekly_digests`
- 9 `brain_reviews`
- 14 `playbook_proposals`
- 0 edited `playbook_versions`
- 0 unsafe personal touches
- 0 orphan call scores

These are not allowed exceptions. The 28 derived artifacts must be exported
and quarantined through `docs/HISTORICAL-METRIC-RECONCILIATION.md` so canonical
0020 and its reusable pgTAP assertions pass without modification.

## 2. Recording impact

The recording pipeline has 440 rows. The measured failures are:

| Cause | Rows | Deepgram billed |
| --- | ---: | --- |
| Missing `transcripts.metric_scope` after transcription | 24 | Yes |
| GHL 422, no recording on message | 42 | No |
| Deepgram timeout | 2 | Unknown |

Nineteen migration-affected rows are parked at `status = 'skipped'` with
`skip_reason = 'held_migration_0020'`. Keep them parked until migrations 0020
through 0024, both assertions, and the recording cursor RPC are verified.

The cursor is pinned at `2026-08-08 18:48:27.5+00` with 500 messages seen and a
held cursor. The GHL paging repair is outside this migration. Do not confuse
the cursor defect or the 42 GHL 422 rows with the schema incident.

## 3. Staging gate

Use the existing separate `yll-ops-hub-staging` project for this rehearsal.
Its clean `0001` through `0024` proof does not exercise the mixed production
starting state. Before replacing that clean staging database, take a protected
staging dump, verify the exact staging project reference, and restore a
sanitized current-state copy. Never restore production customer data into
staging. The staging fixture must reproduce:

- the exact two-row migration ledger;
- the schema after out-of-band 0019;
- the legacy artifact counts and reviewed ID sets;
- representative `app_users`, `auth.users`, live session, and recording rows;
- exactly 19 synthetic parked recordings for the release rehearsal.

Complete these steps in staging in order:

1. Pause every writer named in `HISTORICAL-METRIC-RECONCILIATION.md`.
2. Export and human-review all required artifacts.
3. Build the reviewed six-class manifest. Generate and run its reconciliation
   and canonical 0020 to 0024 in the single transaction in section 5.
4. Run the official migration-history reconciliation in section 7.
5. Run the pgTAP suite and the sign-in, Office read/write, cron, HighLevel,
   Twilio, and live-bridge smokes required by `PHASE-0-RLS-RUNBOOK.md`.
6. Rehearse the canary and remainder recording release in section 8.

Production remains blocked if any step is skipped, weakened, or produces a
state not explicitly handled by this runbook.

## 4. Protected backup and exports

Create a new protected directory outside the repository for every staging and
production attempt. `mktemp` makes the run path unique; `set -C` and the
explicit existence check make accidental overwrite fail closed. Do not reuse a
directory after any failed or uncertain attempt.

```sh
umask 077
set -C
YLL_MIGRATION_ENVIRONMENT="staging" # exactly staging or production
case "$YLL_MIGRATION_ENVIRONMENT" in
  staging|production) ;;
  *) echo "YLL_MIGRATION_ENVIRONMENT must be staging or production" >&2; exit 2 ;;
esac
YLL_MIGRATION_BASE_DIR="/Users/naldovenseizeme/Documents/YLL-Protected-Backups/yll-call-copilot"
install -d -m 700 "$YLL_MIGRATION_BASE_DIR"
YLL_MIGRATION_SECURE_DIR="$(mktemp -d "$YLL_MIGRATION_BASE_DIR/$YLL_MIGRATION_ENVIRONMENT-2026-08-20TXXXXXX")"
YLL_MIGRATION_DUMP="$YLL_MIGRATION_SECURE_DIR/yll-call-copilot-pre-0020.dump"
test ! -e "$YLL_MIGRATION_DUMP"

pg_dump "$SUPABASE_DB_URL" \
  --format=custom \
  --file="$YLL_MIGRATION_DUMP"
pg_restore --list "$YLL_MIGRATION_DUMP" \
  > "$YLL_MIGRATION_SECURE_DIR/yll-call-copilot-pre-0020.contents.txt"
shasum -a 256 "$YLL_MIGRATION_DUMP" \
  > "$YLL_MIGRATION_SECURE_DIR/yll-call-copilot-pre-0020.dump.sha256"
```

Record the dump identifier, checksum, and row counts in the deployment ticket.
Run the inventory and encrypted export steps in
`docs/HISTORICAL-METRIC-RECONCILIATION.md`. A second person must compare the
reviewed manifest with the export before the generated transaction runs.

## 5. Apply canonical 0020 through 0024 atomically

Keep all listed writers paused. Generate the driver from the checked-in
canonical migrations, then inspect it before applying. The generator refuses
missing or reordered files, internal transaction control, or a weakened 0020.
It does not update migration history.

```sh
node scripts/prepare-0020-hosted-apply.mjs \
  --manifest "$YLL_MIGRATION_SECURE_DIR/reviewed-metric-artifacts.csv" \
  --output "$YLL_MIGRATION_SECURE_DIR/0020-0024-hosted.sql"

psql "$SUPABASE_DB_URL" \
  -X \
  --set ON_ERROR_STOP=on \
  --file "$YLL_MIGRATION_SECURE_DIR/0020-0024-hosted.sql"
```

The generated driver uses one `begin`/`commit`. It first requires exact
two-way equality between the reviewed six-class manifest and the locked live
sets, performs only keyed and row-counted reconciliation, then preserves every
canonical 0020 through 0024 byte exactly and in order. It runs these
postconditions before commit:

- `transcripts.metric_scope` exists;
- `call_commitments` and `call_commitments_upsert_batch` exist;
- all five expected Operations Hub identity tables exist;
- `advance_recording_sync_cursor` exists;
- both legacy metric assertions pass.

Do not hand-add `metric_scope`, do not remove a preflight, and do not apply the
five migrations in separate transactions.

## 6. Exact schema-apply resume procedure

If `psql` reports an error before commit, the transaction rolls back. Confirm
that all four feature groups below are absent, fix the cause, then rerun the
unchanged driver.

If the connection drops and commit status is unknown, reconnect read-only and
check all four groups:

```sql
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transcripts'
      and column_name = 'metric_scope'
  ) as has_metric_scope,
  to_regclass('public.call_commitments') is not null as has_commitments,
  (
    select count(*) = 5
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'ops_departments',
        'ops_employees',
        'ops_employee_auth_identities',
        'ops_employee_department_memberships',
        'ops_identity_audit_events'
      )
  ) as has_identity_tables,
  to_regprocedure(
    'public.advance_recording_sync_cursor(timestamp with time zone,jsonb)'
  ) is not null as has_cursor_rpc;
```

- All four false means the transaction rolled back. Rerun the same driver.
- All four true plus both assertion calls succeeding means schema apply
  committed. Do not rerun it. Continue to section 7.
- Any mixed result, failed assertion, or unexpected object means production is
  blocked. Keep writers paused, take a fresh dump, and investigate or restore
  into a new database. Do not improvise a partial replay.

## 7. Reconcile migration history with the official CLI

Only after section 5 succeeds, bind the operation to the expected project and
run the checked-in repair script:

```sh
YLL_EXPECTED_SUPABASE_PROJECT_REF="mjmociuxxxwxvasnpxav" \
  node scripts/reconcile-0020-0024-hosted-history.mjs
```

The script performs read-only assertion and exact-history checks, requires an
empty full `public` schema diff against canonical migrations, and uses pinned
`npx --yes supabase@2.112.0 migration repair`. It reverts only the two reviewed
generated versions, marks only canonical 0001 through 0024 applied, rechecks
the exact history and full schema, and requires an empty `db push --dry-run`.
It never writes the internal migration table directly.

If its connection result is unknown, query ordered `version` and `name` values:

- any remaining subset of the two exact timestamp rows resumes their revert;
- an empty ledger or an exact-name subset of canonical 0001 through 0024
  resumes only the missing applied repair;
- exact canonical 0001 through 0024 proceeds to schema diff and dry-run proof;
- any mixed, extra, or wrong-name row blocks production.

## 8. Release parked recordings in two transactions

Create two reviewed, one-UUID-per-line files in the protected directory: an
exact three-ID canary file and an exact sixteen-ID remainder file. Their
disjoint union must equal the locked 19-row held set. Keep every recording
writer paused. Generate two protected, directly executable SQL files. The
generator requires sorted lowercase canonical UUIDs, exact 3/16 counts,
disjoint files, no existing outputs, and embeds the reviewed IDs through `COPY
FROM STDIN`:

```sh
node scripts/prepare-0020-recording-release.mjs \
  --canary-ids "$YLL_MIGRATION_SECURE_DIR/recording-canary-ids.csv" \
  --remainder-ids "$YLL_MIGRATION_SECURE_DIR/recording-remainder-ids.csv" \
  --canary-output "$YLL_MIGRATION_SECURE_DIR/0020-recording-canary-release.sql" \
  --remainder-output "$YLL_MIGRATION_SECURE_DIR/0020-recording-remainder-release.sql"

psql "$SUPABASE_DB_URL" -X --set ON_ERROR_STOP=on \
  --file "$YLL_MIGRATION_SECURE_DIR/0020-recording-canary-release.sql"
```

The generated canary transaction proves the two files exactly equal the locked
19-row held set, releases only the reviewed canary IDs, and proves those three
are the only rows eligible for the existing generic worker. Keep the scheduled
`sync-recordings` cron and any `CRON_ENABLED` deployment switch paused. Through
an authenticated Office session with the existing pipeline-run capability,
issue exactly `POST /api/recordings/continue` once. Require the JSON response to
report `configured: true`, `migrated: true`, `done: 3`, `skipped: 0`, and
`failed: 0`. Then query the three reviewed IDs and require each to be
`transcribed` with a non-null `transcript_id`. Verify exactly three rows with
`skip_reason = 'released_0020_canary'` reached `status = 'transcribed'`. The
durable skip-reason marker survives the current pipeline's failure-detail
rewrite. If any canary fails or skips, stop and investigate. Do not release the
remainder. When all three succeed, run:

```sh
psql "$SUPABASE_DB_URL" -X --set ON_ERROR_STOP=on \
  --file "$YLL_MIGRATION_SECURE_DIR/0020-recording-remainder-release.sql"
```

The second transaction reimports the same files, requires exact two-way
equality for the three transcribed canaries and sixteen still-held rows, and
releases only the reviewed remainder IDs. Both scripts refuse replay or any
unreviewed eligible worker row.

With cron still paused, process the remainder through the same authenticated
`POST /api/recordings/continue` route exactly three times. Verify each response
before continuing: the first two must each report `configured: true`,
`migrated: true`, `done: 6`, `skipped: 0`, and `failed: 0`; the third must report
the same fields with `done: 4`. Query the exact sixteen reviewed remainder IDs
afterward and require two-way set equality with rows at `status =
'transcribed'`, non-null `transcript_id`, and `skip_reason =
'released_0020_remainder'`. Any wrong count, skipped/failed result, extra
eligible row, or wrong ID blocks writer restart.

The 24 paid-transcription failures are a separate deliberate re-drive. The 42
GHL 422 rows must not be retried without a recording source.

## 9. Completion evidence

Attach all of the following to the deployment ticket before resuming writers:

- protected dump path, checksum, and restore-list evidence;
- reviewed export counts and two-person approval;
- empty post-quarantine inventory and both passing assertions;
- successful one-transaction schema driver output;
- canonical `0001` through `0024` migration list;
- pgTAP and signed smoke results;
- three successful recording canaries and 16-row remainder release evidence;
- current RLS posture and advisor output.

The GHL cursor paging defect, 24 paid-transcription re-drives, and 42 GHL 422
rows remain separately tracked follow-ups. They do not authorize weakening any
migration or release assertion.
