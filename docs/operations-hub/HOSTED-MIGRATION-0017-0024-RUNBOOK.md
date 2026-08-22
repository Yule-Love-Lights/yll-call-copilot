# Hosted migration runbook: 0017 to 0024

Status: **staging rehearsal passed; production B1 evidence capture and B2 schema apply require separate exact authorizations; recording recovery deferred**
Date: 2026-08-22
Project: `mjmociuxxxwxvasnpxav` (Supabase, `us-east-2`, PostgreSQL 17.6.1.141)
Hosted state: **0017 and 0018 ledger-applied; 0019 schema-applied out of band;
0020 to 0024 absent**
Staging: `yll-ops-hub-staging` (`ewbtkrytrnerypdkuimd`) passed the clean target
and sanitized production-shaped `0019` through `0024` rehearsal. Migration
`0025` was applied later for static shared-password staging only; it remains
outside this production procedure. Shared staging has not applied
`20260821141530_office_tasks.sql`. The exact production-deferred migrations
after `0024` are `0025_quote_tool_identity_bridge.sql` and
`20260821141530_office_tasks.sql`; neither is part of this procedure.

This runbook covers the measured hosted state. It does not supersede
`PHASE-0-RLS-RUNBOOK.md`. That runbook's staging, backup, smoke, and production
gates remain mandatory. This document does not authorize any production write.
Production requires a later message that names the exact merged revision and
authorizes only the bounded actions listed in the execution packet.

## 1. Measured hosted state

`supabase_migrations.schema_migrations` contains only these rows:

- `20260819235532 / 0017_live_dial_grants`
- `20260820001714 / 0018_webhook_idempotency`

Migration 0019 is visible in the schema but absent from that ledger. All 31
public tables have RLS enabled and forced, `anon` lacks public-schema usage,
and `anon` has no public-table grants. Migrations 0020 through 0024 are absent:
`transcripts.metric_scope`, `call_commitments`, the five `ops_*` tables, and
`advance_recording_sync_cursor` do not exist. Do not use `supabase db push`
against this mixed history. The later `ops_employee_external_identities`,
`ops_tasks`, and `ops_task_events` feature groups are also absent because both
deferred migrations after `0024` remain unapplied in production.

The same-project `backup_s60_20260819` schema still contains 31 snapshot tables,
but it is no longer current: on 2026-08-22, 30 tables still matched and
`call_recordings` had 10 additional live rows. It is a recovery aid, not a
protected or off-box backup.

Supabase reported a completed physical production backup at
`2026-08-22T10:41:46.106Z`; PITR was disabled. Recheck the actual latest backup
immediately before any production write. A dated platform backup never replaces
the protected artifact exports required below.

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

The recording pipeline had 450 rows in the 2026-08-22 read-only audit: 87
transcribed, 285 skipped, 68 failed, 10 pending, and no stale processing row.
The 68 measured failures are:

| Cause | Rows | Deepgram billed |
| --- | ---: | --- |
| Missing `transcripts.metric_scope` after transcription | 24 | Yes |
| GHL 422, no recording on message | 42 | No |
| Deepgram timeout | 2 | Unknown |

Nineteen migration-affected rows are parked at `status = 'skipped'` with
`skip_reason = 'held_migration_0020'`. Keep them parked until migrations 0020
through 0024, both assertions, and the recording cursor RPC are verified.

The 10 unrelated pending rows are a hard stop for the checked-in 3/16 release
guard. Do not process, reclassify, or park them as part of the schema rollout.
Recording release and every retry remain a separate authorization after the
pipeline's partial-write/idempotency recovery is fixed and rehearsed.

The cursor is pinned at `2026-08-08 18:48:27.5+00` with 500 messages seen and a
held cursor. The GHL paging repair is outside this migration. Do not confuse
the cursor defect or the 42 GHL 422 rows with the schema incident.

## 3. Completed staging gate

The existing separate `yll-ops-hub-staging` project completed this rehearsal on
2026-08-20 at Hub commit
`51c9467f172fb03129c97d1fd06511ce14b309ca`. No production customer data was
restored. The sanitized fixture reproduced:

- the exact two-row migration ledger;
- the schema after out-of-band 0019;
- the legacy artifact counts and reviewed ID sets;
- representative `app_users`, `auth.users`, live session, and recording rows;
- exactly 19 synthetic parked recordings for the release rehearsal.

The rehearsal completed these steps in order:

1. Pause every writer named in `HISTORICAL-METRIC-RECONCILIATION.md`.
2. Export and human-review all required artifacts.
3. Build the reviewed six-class manifest. Generate and run its reconciliation
   and canonical 0020 to 0024 in the single transaction in section 5.
4. Run the official migration-history reconciliation in section 7.
5. Run 481/481 database assertions and verify 38 tables, 30 routines, 12
   triggers, forced RLS, zero policies, and zero browser-role table grants.
6. Rehearse the exact 3/16 recording release guard with synthetic completion.

The atomic driver, official history repair, and public-schema parity proof
passed. The recording completion was synthetic, not a provider-faithful
GHL/Deepgram test.
That limitation now blocks only the separately deferred recording recovery,
not the schema-only `0020` through `0024` rollout. Production remains blocked
if any production prerequisite is skipped, weakened, or differs from the
reviewed state.

The protected evidence index is
`staging-2026-08-20TiFLHmZ/STAGING-REHEARSAL-RESULTS.md`. Its independently
rechecked SHA-256 chain is:

- 28-row synthetic manifest:
  `4ab165bd8643e6945e37ab381c1dfc34126d79674840339b6c17e25355961e16`;
- atomic driver:
  `4f155ac66581c35f561ac3b30666c36fd99501254f389facef587920ca067009`;
- pre-apply dump:
  `ed57e438945975ec5e1517c40eec10a7616a251e2d00e29545dc2767edcd7bbb`;
- post-apply dump:
  `74e5870ae2193b4d34993eb3a3b117e2832998bfed8fb2140c880bc31304fa2f`.

That rehearsal used the PR #60 helper at `51c9467`. The current target guard,
full migration-hash manifest, canonical-only local shadow sidecar, explicit
CA-backed CLI target, and in-memory schema-byte comparison still require an
exact-current disposable production-shaped rehearsal before B2. Current
all-26-migration CI is supporting evidence, not a substitute for that `0024`
rehearsal.

## 4. B1 writer freeze, protected dump, export, and restore proof

Before the backup, verify without printing values that production is pinned to
the separately authorized revision, uses
`NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE=hub`, has
`NEXT_PUBLIC_SUPABASE_URL=https://mjmociuxxxwxvasnpxav.supabase.co/`, has no
`NEXT_PUBLIC_QUOTE_TOOL_AUTH_*` values, retains the two approved Hub Auth owner
UUIDs, and has
`CRON_ENABLED`, `GHL_SEND_ENABLED`, `GHL_FOLLOWUP_SEND_ENABLED`, and
`LIVE_CUSTOMER_CALLS_ENABLED` false or absent. Any mismatch stops the run.
Do not remove or change unrelated server-only `QUOTE_TOOL_SUPABASE_*` values.
The frozen preflight must also show 2 `app_users` and zero malformed identity
emails, unsupported roles, duplicate normalized emails, missing Auth matches,
and ambiguous Auth matches.

This section requires the execution packet's B1 authorization. Pause the exact
`yll-call-copilot` Vercel project through the reviewed control-
plane action documented at <https://vercel.com/docs/projects/managing-projects>.
Verify the production URL returns Vercel's `503 DEPLOYMENT_PAUSED`, then allow
six minutes for the longest five-minute function plus a one-minute drain
margin. Confirm no invocation remains active. This is the machine-enforced
writer boundary for browser actions, webhooks, manual pipeline routes, and all
six cron handlers. Do not merely ask operators to stay out of the app. B1
authorizes only the pause/resume, protected dump, and read-only export. It does
not authorize a database mutation.

Before B1, verify Node 24, matching PostgreSQL 17 clients, Docker running, the
lockfile-installed Supabase CLI at 2.112.0, its exact-version `supabase-go`
sidecar, and a guarded `SUPABASE_DB_URL` for the exact port-5432 target. The
workflow needs neither a Supabase project link nor a platform access token.
Obtain the exact production Supabase CA PEM in a protected regular file under a
mode-`0700` directory, and independently review its SHA-256. This Mac currently
lacks the PostgreSQL clients, Docker, and the reviewed CA, so B1 is blocked
until all are installed or obtained and verified. Before B2, the exact CA and
`verify-full` path must pass an exact-current disposable rehearsal against the
supported port-5432 connection mode selected for the run. Rehearse both frozen
direct and session-pooler shapes when both are network-reachable. See the
Supabase [SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement)
and [psql connection](https://supabase.com/docs/guides/database/psql) guidance.

Create a new protected directory outside the repository for every staging and
production attempt. It must reside on a verified FileVault-encrypted local
volume or equivalently protected encrypted storage. `mktemp` makes the run
path unique, while the guarded dump command creates the dump exclusively with
mode `0600` and refuses overwrite. Do not reuse a directory after any failed
or uncertain attempt, including a partial dump.

```sh
umask 077
set -euC
export YLL_MIGRATION_ENVIRONMENT="production"
export YLL_EXPECTED_SUPABASE_PROJECT_REF="mjmociuxxxwxvasnpxav"
export YLL_SUPABASE_SSL_ROOT_CERT="<absolute protected downloaded Supabase CA path>"
export YLL_EXPECTED_SUPABASE_SSL_ROOT_CERT_SHA256="<reviewed 64-lowercase CA SHA-256>"
YLL_MIGRATION_BASE_DIR="/Users/naldovenseizeme/Documents/YLL-Protected-Backups/yll-call-copilot"
install -d -m 700 "$YLL_MIGRATION_BASE_DIR"
YLL_MIGRATION_ATTEMPT_LABEL="production-YYYY-MM-DDTHHMMSS"
YLL_MIGRATION_SECURE_DIR="$(mktemp -d "$YLL_MIGRATION_BASE_DIR/$YLL_MIGRATION_ATTEMPT_LABEL-XXXXXX")"
YLL_MIGRATION_DUMP="$YLL_MIGRATION_SECURE_DIR/yll-call-copilot-pre-0020.dump"
node scripts/guarded-supabase-db.mjs dump --output "$YLL_MIGRATION_DUMP"
install -d -m 700 "$YLL_MIGRATION_SECURE_DIR/review"
node scripts/export-0020-production-review.mjs \
  --directory "$YLL_MIGRATION_SECURE_DIR/review"
pg_restore --list "$YLL_MIGRATION_DUMP" \
  > "$YLL_MIGRATION_SECURE_DIR/yll-call-copilot-pre-0020.contents.txt"
shasum -a 256 "$YLL_MIGRATION_DUMP" \
  > "$YLL_MIGRATION_SECURE_DIR/yll-call-copilot-pre-0020.dump.sha256"
```

The target helper rejects a missing, linked, unprotected, or digest-mismatched
CA before starting any database child. Its sanitized production libpq
environments set `PGSSLMODE=verify-full` and `PGSSLROOTCERT` to the exact
reviewed path. For migration repair and dry-run, it gives the pinned Supabase
CLI a passwordless explicit `--db-url` containing `sslmode=verify-full` and the
exact `sslrootcert` path; the CLI child receives the password only as
`PGPASSWORD` in the sanitized environment. No password or secret appears in
the process arguments, and no Supabase link or platform token is used. Do not accept
`sslmode=require` or the system default certificate store for this run.

The exporter uses one repeatable-read, read-only snapshot and the canonical
six-class predicate. It writes 14 fixed-order CSV outputs and
`export-file-digests.sha256`, for 15 protected files total. Complete-row CSVs,
`identity-backfill-map.csv`, and `reviewed-identity-backfill.csv` stay only in
the protected directory because they can contain employee or customer
information. The raw identity map is sorted and binds the exact `app_users`
employee ID, normalized email, normalized legacy and backfilled roles, legacy
timestamp, and matching Auth UUID used by the later backfill. A second person
must compare the exact artifact manifest with every complete-row export,
privately verify every raw identity-map row, and confirm the separate
`reviewed-identity-backfill.csv` machine manifest without copying either
identity file's contents into chat, logs, or the ticket. The SHA-256 of
`export-file-digests.sha256` is the export-set SHA-256 printed in the exporter
success marker; it binds all 14 CSV outputs.

Resume Vercel after capture and verify ordinary service, password login, and
approved non-provider Office reads. Then restore the exact dump into a new
isolated Supabase-compatible PostgreSQL 17 target. `pg_restore --list` proves
only archive readability. B2 remains blocked until the real restore succeeds
and the restored baseline and artifact counts match. Do not leave production
paused while waiting for artifact review.

## 5. B2 apply canonical 0020 through 0024 atomically

Generate and inspect the driver after B1. The generator refuses
missing or reordered files, internal transaction control, or a weakened 0020.
It does not update migration history.

```sh
node scripts/prepare-0020-hosted-apply.mjs \
  --manifest "$YLL_MIGRATION_SECURE_DIR/review/reviewed-metric-artifacts.csv" \
  --identity-manifest "$YLL_MIGRATION_SECURE_DIR/review/reviewed-identity-backfill.csv" \
  --output "$YLL_MIGRATION_SECURE_DIR/0020-0024-hosted.sql"
```

Record the export-set, identity-manifest, artifact-manifest, driver, and
reviewed Supabase CA digests, obtain the packet's separate B2 authorization
bound to all five, then pause and drain Vercel again. Recheck that the exact CA
file still matches its authorized digest before taking the fresh protected
dump. Copy the exact authorized export-set digest and rerun the exporter in a
new empty directory through its machine gate:

```sh
YLL_MIGRATION_EXPORT_SET_SHA256="<exact export-set SHA from B2 authorization>"
YLL_MIGRATION_B2_REVIEW_DIR="$YLL_MIGRATION_SECURE_DIR/review-b2"
install -d -m 700 "$YLL_MIGRATION_B2_REVIEW_DIR"
node scripts/export-0020-production-review.mjs \
  --directory "$YLL_MIGRATION_B2_REVIEW_DIR" \
  --expected-export-set-sha256 "$YLL_MIGRATION_EXPORT_SET_SHA256"
```

Do not recompute and trust a new digest from the fresh files. A mismatch fails
before any database write and retains the protected evidence for investigation.
The export-set SHA, six counts, identity-manifest SHA, artifact-manifest SHA,
and `production-preflight.csv` must exactly match B2 authorization. The reviewer
privately confirms the fresh `identity-backfill-map.csv` reproduces the
authorized mapping and the fresh `reviewed-identity-backfill.csv` reproduces the
authorized machine manifest without exposing either file's contents. Keep
Vercel continuously paused and drained from that fresh re-export through atomic
apply, history repair, and direct database proof.

Set the following value by copying the exact driver digest named in B2. Never
recompute and silently trust a different file at apply time.

```sh
YLL_MIGRATION_DRIVER_SHA256="<exact driver SHA from B2 authorization>"
node scripts/guarded-supabase-db.mjs apply \
  --file "$YLL_MIGRATION_SECURE_DIR/0020-0024-hosted.sql" \
  --sha256 "$YLL_MIGRATION_DRIVER_SHA256"
```

The generated driver uses one `begin`/`commit`. It first requires exact two-way
equality between both reviewed manifests and the locked identity/artifact live
sets, performs only keyed and row-counted reconciliation, then preserves every
canonical 0020 through 0024 byte exactly and in order. It runs these
postconditions before commit:

- `transcripts.metric_scope` exists;
- `call_commitments` and `call_commitments_upsert_batch` exist;
- all five expected Operations Hub identity tables exist;
- `advance_recording_sync_cursor` exists;
- both legacy metric assertions pass.

The wrapper reconstructs the expected driver from its embedded strict identity
and artifact manifests plus the pinned preamble/migrations, rejects any non-
generated input, validates the exact protected CA file and reviewed digest,
sets `PGSSLMODE=verify-full` and `PGSSLROOTCERT` in its sanitized child
environment, suppresses child output, and emits only its success marker.
Archive that marker and use separate allowlisted, PII-free aggregate queries
for postconditions. Do not require transaction output that the wrapper
deliberately does not expose.

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

Only after section 5 succeeds, keep the exact target declarations,
`SUPABASE_DB_URL`, `YLL_SUPABASE_SSL_ROOT_CERT`, and
`YLL_EXPECTED_SUPABASE_SSL_ROOT_CERT_SHA256` in the protected operator
environment, then run the checked-in repair script. Do not print the database
URL or password:

```sh
YLL_MIGRATION_ENVIRONMENT="production" \
YLL_EXPECTED_SUPABASE_PROJECT_REF="mjmociuxxxwxvasnpxav" \
  node scripts/reconcile-0020-0024-hosted-history.mjs
```

The script performs read-only assertion and exact-history checks, then invokes
the lockfile-installed Supabase CLI 2.112.0 against a target-guard-built,
passwordless explicit `--db-url`. That URL includes `sslmode=verify-full` and
the exact reviewed `sslrootcert`; the CLI child receives the password only as
`PGPASSWORD` in the allowlisted environment. It does not link a Supabase
project and does not use a platform access token.

For the complete-schema proof, the exact-version `supabase-go` sidecar creates
a secret-free local shadow from only canonical `0001` through `0024`. The
same-host PostgreSQL 17 `pg_dump` binary creates full public schema-only dumps
for that shadow and production. The helper normalizes only the two
source/client version banners and compares every other byte in memory before
and after history repair. The same pre/post proof requires the seeded
version-1 rubric and offer rows with their `seeded` source plus the
coach-settings singleton. It creates no schema snapshot artifact or new
authorization digest, and removes only the exact validated shadow container.
The pinned CLI reverts
only the two reviewed generated versions, marks only canonical `0001` through
`0024` applied, and rechecks the exact history and schema bytes. Its final
`db push --dry-run` must report exactly the two separately reviewed, deferred
migrations `0025_quote_tool_identity_bridge.sql` and
`20260821141530_office_tasks.sql`, and nothing else. It never writes the
internal migration table directly.

If its connection result is unknown, query ordered `version` and `name` values:

- any remaining subset of the two exact timestamp rows resumes their revert;
- an empty ledger or an exact-name subset of canonical 0001 through 0024
  resumes only the missing applied repair;
- exact canonical 0001 through 0024 proceeds to the in-memory schema-byte
  comparison and dry-run proof;
- any mixed, extra, or wrong-name row blocks production.

## 8. Keep every recording recovery path deferred

Do not generate or apply a 3/16 release file during this schema rollout. The
10 unrelated pending rows currently violate the release guard. The recording
route also needs a separate reviewed fix for final-state update errors and
partial-write/idempotency recovery before a paid provider can be called safely.

The 19 parked rows, 24 paid-transcription failures, 42 GHL 422 rows, and two
Deepgram timeout rows remain four explicit follow-ups. Do not retry any of
them under this authorization. A later recording-recovery packet must
re-inventory the live sets, verify billing and duplicate-transcript safety,
rehearse failure recovery, and receive its own exact write authorization.

## 9. Completion evidence and resume order

Attach all of the following to the deployment ticket before resuming writers:

- protected dump path, checksum, archive list, and passed isolated-restore
  rehearsal;
- reviewed export-set SHA, identity-manifest SHA, artifact-manifest SHA, export
  counts, reviewed Supabase CA SHA, and two-person approval, with no CA or
  identity-map contents outside protected storage;
- proof that the target helper accepted the exact reviewed CA and provided
  `PGSSLMODE=verify-full` plus its `PGSSLROOTCERT` path to every hosted database
  child;
- empty post-quarantine inventory and both passing assertions;
- guarded-wrapper success marker and separate PII-free postcondition
  aggregates;
- canonical `0001` through `0024` migration list;
- byte-identical canonical-shadow and production full public schema-only dumps
  before and after history repair, with only their version banners normalized,
  plus confirmed removal of the exact validated shadow container;
- the protected 481/481 production-shaped `0024` rehearsal, direct Auth/config
  proof, and real-key default-deny result;
- current RLS posture and advisor output.

Current CI applies all 26 migrations and reaches 41 tables, 37 routines, and 15
triggers. Do not describe it as a production `0024` pgTAP run and do not apply
either `0025_quote_tool_identity_bridge.sql` or
`20260821141530_office_tasks.sql` to reproduce it. The expected advisor baseline
is 31 default-deny INFO notices plus the separate leaked-password protection
WARN. Stop on a new finding, but do not change that Auth setting under this
packet.

Before resuming Vercel, verify the four outbound/write switches remain false,
review any webhook retry exposure created by the maintenance window, and use
Vercel's Resume Service action. Do not resume any separate Railway service.
Only after resume can the app password-login and approved non-provider Office
read checks run. Re-pause immediately if one fails. Do not test recovery email,
calls, sends, providers, or cron.
The GHL cursor paging defect, 19-row recording release, 24 paid-transcription
re-drives, 42 GHL 422 rows, and two Deepgram timeouts remain separately tracked
follow-ups. They do not authorize weakening any migration assertion.
