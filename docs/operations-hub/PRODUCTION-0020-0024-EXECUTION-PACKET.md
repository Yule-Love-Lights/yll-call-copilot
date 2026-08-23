# Production 0020-0024 execution packet

Status: **superseded for operations; retained for recovery-procedure audit only**
Date: 2026-08-22
Repository target: `Yule-Love-Lights/yll-call-copilot`
Database target: `yll-call-copilot` (`mjmociuxxxwxvasnpxav`, PostgreSQL 17)
Application host: Vercel only; Railway is retired and must remain disconnected

The owner selected the no-recovery rollout direction in
[`PRODUCTION-0020-0024-NO-BACKUP-PLAN.md`](PRODUCTION-0020-0024-NO-BACKUP-PLAN.md).
Do not use this B1/B2 dump, restore, or export-review procedure unless that
decision is explicitly withdrawn and a new review authorizes it.

This packet bounds the remaining production database work. A branch, pull
request, or unmerged SHA is never an execution target. The two later production
authorizations in section 3 must be separate messages because the reviewed
export set, identity/artifact manifests, and driver do not exist until the first maintenance
window has safely captured the frozen production state.

## 1. Frozen scope

Only the following work can be authorized through this packet:

- pause and resume the exact Hub Vercel production project;
- create and prove a fresh protected production dump;
- export and second-person review the exact six historical artifact classes;
- delete only the reviewed historical artifacts and their reviewed collateral;
- apply canonical migrations `0020` through `0024` in the same transaction as
  those exact deletions;
- repair only the reviewed migration-history rows with the pinned official
  Supabase CLI;
- run read-only database proofs and non-provider application checks.

The driver is destructive by design. At the currently observed state it
deletes 5 weekly digests, 9 brain reviews, and 14 playbook proposals. It also
deletes any separately reviewed edited playbook, unsafe personal-touch, orphan
call-score, and orphan-score feedback-card rows and changes only the reviewed
edited-playbook fallback pointers. The last four sets are currently zero. No
person may authorize this by the shorthand phrase "apply the driver" alone.

Explicitly excluded:

- production application of `0025_quote_tool_identity_bridge.sql` or
  `20260821141530_office_tasks.sql`;
- Quote Tool identity activation in production;
- Quote identity revocation, replacement, recovery, or membership changes;
- live calls, Railway, Twilio, Twilio Verify, Turnstile, or Cloudflare;
- customer follow-up sends or HighLevel send tests;
- enabling or running a cron job;
- releasing the 19 parked recordings;
- retrying the 24 paid-transcription failures, 42 GHL 422 rows, or 2 Deepgram
  timeout rows;
- repairing the GHL cursor;
- any Quote Tool repository or database change;
- recreating an edited playbook. The frozen edited count must remain zero for
  this packet or that work receives a separate exact authorization.

## 2. Read-only baseline to recheck

The 2026-08-22 audit found:

- migration history contains only generated `0017` and `0018` rows;
- `0019` is present in schema but absent from migration history;
- 31 public tables, 0 public routines, 0 non-internal triggers, 0 views, 0
  policies, and 2 public sequences;
- all 31 tables are owned by `postgres`, have RLS enabled and forced, and have
  zero `anon` or `authenticated` table grants;
- `service_role` exists with `BYPASSRLS`, and no public table is on a
  publication path;
- no `0020` through `0024` feature group exists;
- 2 `app_users`, with zero malformed email, unsupported role, duplicate
  normalized email, missing Auth match, and ambiguous Auth match preflights;
- the six historical classes total 28 rows: 5 weekly digests, 9 brain reviews,
  14 playbook proposals, and zero edited playbooks, unsafe personal touches,
  or orphan call scores;
- 450 recordings: 87 transcribed, 285 skipped, 68 failed, 10 pending, and zero
  stale processing; the 19 migration-held rows remain parked;
- a completed physical backup at `2026-08-22T10:41:46.106Z`; PITR is disabled;
- the same-project `backup_s60_20260819` schema is stale by 10 recording rows
  and is not the protected recovery artifact;
- 31 expected `RLS Enabled No Policy` security-advisor INFO notices and one
  `Leaked Password Protection Disabled` WARN.

The advisor WARN is a separate Auth-control decision. Do not change it during
this packet. Any new advisor finding or any drift in the structural, identity,
artifact, migration, publication, role, or recording baseline stops the run.

## 3. Two exact later authorization boundaries

### B1: evidence-capture authorization

After this preparation PR is merged and verified, the first later message may
use this wording:

> Prepare production 0020-0024 evidence for
> Yule-Love-Lights/yll-call-copilot at merged SHA `<exact SHA>`. You may pause
> and resume only its Vercel production project, take a protected dump, and run
> the checked-in read-only export against Supabase project
> `mjmociuxxxwxvasnpxav`. Do not change database data, schema, migration
> history, environment values, calls, sends, cron, recordings, Railway, or
> Quote Tool.

B1 permits the Vercel pause/resume control-plane writes and read-only database
access only. It does not permit a database mutation. Resume Vercel after the
capture so review does not create an open-ended production outage.

Outside production, restore the exact dump into an isolated Supabase-compatible
PostgreSQL 17 target and verify it. A second person then reviews the exports,
both manifests, and generated driver. Present all of the following before B2:

- merged Hub SHA and target ref;
- dump SHA-256 and successful isolated-restore evidence;
- protected Supabase CA path and its independently reviewed SHA-256, without
  attaching the certificate;
- export-set SHA-256 for the exact 15-file protected export set, plus the six
  exact artifact counts, artifact-manifest SHA-256, and identity-manifest
  SHA-256;
- independent private confirmation that `identity-backfill-map.csv` contains
  the exact reviewed `app_users` employee ID, normalized email, normalized
  legacy and backfilled roles, legacy timestamp, and matching Auth UUID rows,
  without copying those rows into the ticket or logs;
- driver SHA-256 and the plain-language deletion summary;
- exact-current disposable rehearsal of the history helper;
- names of operator and independent reviewer.

Any code, migration, target, reviewed CA digest or file, export-set digest,
export file, manifest, or driver change invalidates that evidence and requires
a new B1 capture.

### B2: database-write authorization

Only after B1 evidence is shown may a new message use wording like:

> Execute production 0020-0024 for Yule-Love-Lights/yll-call-copilot at merged
> SHA `<exact SHA>` against Supabase project `mjmociuxxxwxvasnpxav`, using
> export-set SHA-256 `<exact export-set SHA>`, identity-manifest SHA-256
> `<exact identity-manifest SHA>`, artifact-manifest SHA-256
> `<exact artifact-manifest SHA>`, counts `<six exact counts>`, and driver
> SHA-256 `<exact driver SHA>`, with Supabase CA SHA-256
> `<exact reviewed CA SHA>`. I authorize the driver to delete those exact
> reviewed historical rows and reviewed collateral, update only reviewed
> edited-playbook fallback pointers, apply canonical 0020-0024 atomically,
> repair exact history through 0024, and pause/resume only the Hub Vercel
> project. Do not apply
> `0025_quote_tool_identity_bridge.sql` or
> `20260821141530_office_tasks.sql`, release or retry recordings, enable cron,
> call, send, change Railway, or change Quote Tool.

Authorization binds the merged SHA, target ref, reviewed CA SHA, export-set
SHA, identity-manifest SHA, artifact-manifest SHA, six counts, and driver SHA.
Any change invalidates it. A B2 freeze that does not reproduce the authorized
CA SHA, export-set SHA, both manifests, counts, and preflight must stop without
a database write, then resume Vercel and return for new B1/B2 review.

## 4. Entry gates and current blockers

Stop unless all are true:

- the exact authorized SHA is merged on current `master`; CI, Vercel, and the
  real diff are green;
- Vercel production has `NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE=hub`,
  `NEXT_PUBLIC_SUPABASE_URL=https://mjmociuxxxwxvasnpxav.supabase.co/`, the
  approved two-Hub-UUID owner ceiling, and no
  `NEXT_PUBLIC_QUOTE_TOOL_AUTH_*` variables;
- server-only `QUOTE_TOOL_SUPABASE_*` variables used by unrelated read-only
  integration code are not removed or changed by this packet;
- `CRON_ENABLED`, `GHL_SEND_ENABLED`, `GHL_FOLLOWUP_SEND_ENABLED`, and
  `LIVE_CUSTOMER_CALLS_ENABLED` are false or absent;
- Railway remains disconnected and no live bridge is hosted;
- Node is 24.x; the lockfile-installed Supabase CLI is exactly 2.112.0;
  matching PostgreSQL 17 `pg_dump`, `pg_restore`, and `psql` are installed;
  Docker is installed and running for the exact-version `supabase-go` local
  shadow database;
- `SUPABASE_DB_URL` passes the frozen target guard; the history helper derives
  a passwordless explicit CLI `--db-url` with `sslmode=verify-full` and the
  exact reviewed `sslrootcert`, supplies the password only through
  `PGPASSWORD` in a sanitized environment, and uses neither a project link nor
  a platform access token;
- `YLL_SUPABASE_SSL_ROOT_CERT` is the absolute, normalized path to the exact
  downloaded production Supabase CA PEM in a mode-`0700` directory, the file
  is a protected regular file, and
  `YLL_EXPECTED_SUPABASE_SSL_ROOT_CERT_SHA256` is the independently reviewed
  matching 64-lowercase-character SHA-256;
- the latest Supabase physical backup is completed and newer than the prior
  application write; PITR status is recorded without assuming it is enabled;
- the protected destination is unique, mode `0700`, on encrypted storage, and
  has room for the dump, exports, restore proof, checksums, and evidence;
- no identity replacement or membership change is scheduled for either window.

Before B2, the independent reviewer must privately verify the exact
`app_users` employee ID, normalized email, normalized legacy and backfilled
roles, legacy timestamp, and Auth UUID mapping in the protected
`identity-backfill-map.csv`. Never put the mapping
contents in chat, deployment logs, or the ticket; only its bound export-set
digest and a PII-free review result may leave protected storage.

This Mac currently lacks the PostgreSQL 17 clients, Docker, and the protected
reviewed Supabase CA. B1 is blocked until they are installed or obtained and
verified. Before B2, the exact downloaded CA and `verify-full` path must pass
an exact-current disposable production-shaped rehearsal against the supported
port-5432 connection mode selected for the run. Rehearse both the frozen direct
and session-pooler shapes when both are network-reachable. Follow Supabase's
[SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement)
and [psql connection](https://supabase.com/docs/guides/database/psql)
guidance. Never substitute a plain `supabase db push`.

## 5. B1 evidence capture

1. Record the exact Vercel project, domain, deployment SHA, target ref, and
   switch names without copying secret values.
2. Pause only the Hub Vercel project. Verify the domain returns Vercel's
   `503 DEPLOYMENT_PAUSED`, allow six minutes for the longest five-minute
   function plus margin, and prove no invocation remains active.
3. Create a unique protected directory and export the target declarations:

```sh
umask 077
set -euC
export YLL_MIGRATION_ENVIRONMENT="production"
export YLL_EXPECTED_SUPABASE_PROJECT_REF="mjmociuxxxwxvasnpxav"
export YLL_SUPABASE_SSL_ROOT_CERT="<absolute protected downloaded Supabase CA path>"
export YLL_EXPECTED_SUPABASE_SSL_ROOT_CERT_SHA256="<reviewed 64-lowercase CA SHA-256>"
YLL_MIGRATION_SECURE_DIR="<absolute unique mode-0700 protected directory>"
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

Every target-bound production database command validates the protected CA file
and reviewed digest before starting a child process. Sanitized libpq
environments set `PGSSLMODE=verify-full` and `PGSSLROOTCERT` to that exact
reviewed path. Migration repair and dry-run use a target-guard-built,
passwordless explicit CLI `--db-url` with the same `verify-full` mode and exact
CA path while the password remains only in `PGPASSWORD`; no Supabase link or
platform token is used. `sslmode=require` or a system default certificate
store is not sufficient for this packet.

The exporter uses one repeatable-read, read-only snapshot and the exact
canonical `0020` predicates. It writes 14 fixed-order CSV outputs plus
`export-file-digests.sha256`, for 15 protected files total. Complete-row CSVs,
`identity-backfill-map.csv`, and `reviewed-identity-backfill.csv` may contain
employee or customer data and stay protected. The raw identity map is
deterministically sorted and contains the exact employee ID, normalized email,
legacy/backfilled roles, legacy timestamp, and matching Auth UUID used by the
identity backfill. `reviewed-identity-backfill.csv` is the deterministic
machine manifest. The artifact manifest, artifact counts, and aggregate
preflight are PII-free. The digest index covers every CSV; the SHA-256 of that
index is the export-set SHA printed in the exporter success marker. It refuses
staging, an unsafe directory, or an existing output.

4. Resume only the Hub Vercel project after capture. Confirm ordinary service,
   Hub password login, and approved non-provider Office reads. Re-pause
   immediately if the post-resume check fails. Do not invoke a provider or cron.
5. Restore the exact dump into a new isolated Supabase-compatible PostgreSQL
   17 target. `pg_restore --list` proves archive readability only. B2 remains
   blocked until a real restore completes and the baseline and artifact counts
   match the captured evidence.
6. Have a second person inspect the complete exports and compare the exact
   manifest. In protected storage, privately review every
   `identity-backfill-map.csv` row against the expected `app_users` employee ID,
   normalized email, legacy/backfilled roles, legacy timestamp, and Auth UUID
   mapping. Confirm `reviewed-identity-backfill.csv` is the matching machine
   manifest. Do not copy either file's contents into the ticket. The edited-
   playbook count must remain zero for this packet.
7. Generate the driver into the same protected evidence set:

```sh
YLL_MIGRATION_MANIFEST="$YLL_MIGRATION_SECURE_DIR/review/reviewed-metric-artifacts.csv"
YLL_MIGRATION_IDENTITY_MANIFEST="$YLL_MIGRATION_SECURE_DIR/review/reviewed-identity-backfill.csv"
YLL_MIGRATION_DRIVER="$YLL_MIGRATION_SECURE_DIR/0020-0024-hosted.sql"
node scripts/prepare-0020-hosted-apply.mjs \
  --manifest "$YLL_MIGRATION_MANIFEST" \
  --identity-manifest "$YLL_MIGRATION_IDENTITY_MANIFEST" \
  --output "$YLL_MIGRATION_DRIVER" \
  2> "$YLL_MIGRATION_SECURE_DIR/driver-digests.txt"
shasum -a 256 \
  "$YLL_MIGRATION_MANIFEST" \
  "$YLL_MIGRATION_IDENTITY_MANIFEST" \
  "$YLL_MIGRATION_DRIVER" \
  > "$YLL_MIGRATION_SECURE_DIR/reviewed-apply-digests.sha256"
```

The operator and reviewer must independently hash
`review/export-file-digests.sha256`, confirm it equals the export-set SHA in the
exporter success marker, reconcile both manifest and driver digest sources, and
record only those exact digests, the reviewed CA digest, and PII-free counts in
the ticket. Use all five digests in B2 authorization. Do not derive and
silently trust a new hash at apply time.

## 6. B2 freeze and exact recheck

After exact B2 authorization:

1. Pause and drain Vercel exactly as in B1.
2. Confirm a fresh physical backup is complete. Recheck that the same protected
   CA file still hashes to the exact CA SHA copied from B2 authorization, then
   take a new exclusive protected dump for the write window. A missing or
   mismatched CA stops before re-export or any database write.
3. Copy the export-set digest exactly from B2 authorization and run the
   exporter into a new empty review directory through its machine gate:

```sh
YLL_MIGRATION_EXPORT_SET_SHA256="<exact export-set SHA from B2 authorization>"
YLL_MIGRATION_B2_REVIEW_DIR="$YLL_MIGRATION_SECURE_DIR/review-b2"
install -d -m 700 "$YLL_MIGRATION_B2_REVIEW_DIR"
node scripts/export-0020-production-review.mjs \
  --directory "$YLL_MIGRATION_B2_REVIEW_DIR" \
  --expected-export-set-sha256 "$YLL_MIGRATION_EXPORT_SET_SHA256"
```

   Do not recompute and trust a new digest from the fresh files. A mismatch
   fails before any database write and retains the new protected evidence for
   investigation. Its export-set SHA, identity-manifest SHA, artifact-manifest
   SHA, and all six counts must exactly match B2 authorization. The reviewer
   privately confirms the fresh
   `identity-backfill-map.csv` in that B2 review directory is the exact
   authorized mapping without exposing its contents.
   `production-preflight.csv` must reproduce section 2, including 2 `app_users`
   and all five identity preflight zeros.
4. Recheck the exact migration-history rows, four absent feature groups,
   service-role posture, forced RLS, grants, publications, Vercel SHA, and four
   disabled outbound switches.

From the fresh re-export in step 3 through atomic apply, history repair, and
direct database proof, keep Vercel continuously paused and drained. Do not
reopen a browser, webhook, manual, or scheduled writer between the bound
export snapshot and commit. Any mismatch stops before apply. Resume Vercel
without changing the database and return for new review.

## 7. Atomic apply and history repair

Set the apply digest by copying the exact value from the B2 authorization. Do
not calculate it from an unreviewed file in this shell.

```sh
YLL_MIGRATION_DRIVER="$YLL_MIGRATION_SECURE_DIR/0020-0024-hosted.sql"
YLL_MIGRATION_DRIVER_SHA256="<exact driver SHA from B2 authorization>"
node scripts/guarded-supabase-db.mjs apply \
  --file "$YLL_MIGRATION_DRIVER" \
  --sha256 "$YLL_MIGRATION_DRIVER_SHA256"
```

The wrapper hashes the same no-follow file bytes sent to `psql`, freezes the
production target, reconstructs the expected driver from its embedded strict
identity/artifact manifests plus the pinned preamble and migrations, rejects
any non-generated input, validates the protected CA path and reviewed digest,
sets `PGSSLMODE=verify-full` and `PGSSLROOTCERT` in its sanitized child
environment, suppresses child output, and prints only the PII-free
`GUARDED_SUPABASE_DB_OK operation=apply environment=production` marker on
success. Archive that marker. Use separate allowlisted, PII-free read-only
aggregates for postconditions; raw transaction output is intentionally
unavailable.

The generator hash-pins its reconciliation preamble and these migrations:

- `0020`: `9eeac3229a5b4b4f0e0bcd4b8d557fc8126a62755c3e07e218a8ccd31ae5763c`
- `0021`: `05b1e7fbb84c9b72673dc02de40c76825252e450f200ceee89fd457786e3aef6`
- `0022`: `305ef296696be2305f4327e16120422c663fd1c68e595f7b8e9d8d2c5787f802`
- `0023`: `f6b3a3f441b61809ec3aa00b9088922f1ccfe20965479a2a205c615ed50febab`
- `0024`: `08de9fee454b980693e5c19c51c86ad44985c144637063947062fa61da6e7abf`

The single transaction locks the reviewed tables, proves two-way equality for
the identity and artifact manifests, performs exact row-counted deletions and
fallback changes, applies byte-identical `0020` through `0024`, runs both
provenance assertions and all schema postconditions, then commits once.

After the successful marker, run:

```sh
node scripts/reconcile-0020-0024-hosted-history.mjs
```

The helper hash-pins all 26 local migrations: canonical `0001` through `0024`
plus the deferred `0025_quote_tool_identity_bridge.sql` and
`20260821141530_office_tasks.sql`. It gives the lockfile-installed CLI a
target-guard-built passwordless explicit `--db-url` with `verify-full` and the
exact reviewed CA, keeps the password only in `PGPASSWORD`, and uses no
Supabase link or platform token. The exact-version `supabase-go` sidecar
creates a secret-free local canonical `0001`-`0024` shadow. The same host
PostgreSQL 17 `pg_dump` binary then creates full public schema-only dumps for
the shadow and production; only the two version banners are normalized before
all remaining bytes are compared in memory both before and after history
repair. Before and after repair, the helper also requires the seeded version-1
rubric and offer rows with their `seeded` source plus the coach-settings
singleton, so schema equality cannot conceal missing data-bearing migration
effects. The helper
creates no schema snapshot artifact or digest, removes the exact validated
shadow container, and must finish with canonical `0001`-`0024`, byte-identical
public schemas, and exactly those two later migrations pending. No plain
`db push`, direct ledger SQL, partial replay, or deferred-migration apply is
allowed.

## 8. Stop and recovery rules

- Before commit, any error must roll back the transaction.
- If commit state is unknown, run the four-feature read-only test in the hosted
  runbook. All false permits only the unchanged authorized retry. All true plus
  both assertions proceeds. Any mixed state stops.
- After a committed problem, do not restore over production and do not reinsert
  exports. Restore the protected dump into a new database and review a cutover.
- If history repair is interrupted, use only the exact resume states in the
  hosted runbook.
- Keep Vercel paused whenever database state, history, or proof is uncertain.
- Never use RLS disablement, browser grants, either deferred migration,
  provider calls, sends, cron, or recording retries as a diagnostic.

## 9. Exit proof and resume

Before resuming Vercel, archive:

- fresh dump checksum, archive list, and the previously passed isolated-restore
  rehearsal;
- authorized export-set SHA, identity-manifest SHA, six-count artifact manifest,
  artifact-manifest SHA, driver SHA, reviewed Supabase CA SHA, and two-person
  approval, with no certificate or identity-map contents in the ticket;
- target-helper proof that the exact CA file passed its digest gate and all
  hosted libpq children used `PGSSLMODE=verify-full` plus the reviewed
  `PGSSLROOTCERT` path;
- guarded-wrapper success marker and PII-free postcondition aggregates;
- exact canonical `0001` through `0024` history;
- byte-identical full public schema-only dumps for the canonical shadow and
  production before and after history repair, with only their version banners
  normalized, the exact shadow container removed, and exactly
  `0025_quote_tool_identity_bridge.sql` and
  `20260821141530_office_tasks.sql` pending;
- 38-table, 30-routine, 12-trigger `0024` posture, forced RLS, zero policies,
  zero browser-role access, and expected advisor baseline;
- direct Auth/config proof, real-key PostgREST denial, and negative proofs that
  cron, sends, and live calling remain disabled.

The protected 481/481 pgTAP evidence came from the production-shaped `0024`
staging rehearsal. Current CI applies all 26 migrations and reaches 41 tables,
37 routines, and 15 triggers; it is not a production `0024` pgTAP run. Do not
apply either deferred migration merely to rerun that suite.

Resume only the Hub Vercel project. Then confirm the production deployment,
Hub password login, and approved non-provider Office reads. If an app check
fails, re-pause immediately. Railway stays disconnected. Recording and cron
writers stay parked for their own later packets and authorizations.
