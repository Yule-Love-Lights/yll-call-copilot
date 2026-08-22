# Historical metric reconciliation

Migration 0020 intentionally rejects legacy metric artifacts whose employee-
performance provenance cannot be proved. Do not relabel ambiguous history and
do not weaken the migration. The reviewed artifacts and canonical migrations
0020 through 0024 must commit in one transaction.

## 1. Required maintenance boundary

The protected production-shaped staging rehearsal passed for the PR #60
procedure. The current target guard, pinned CLI and exact-version sidecar,
migration hash manifest, canonical-only local shadow, in-memory public-schema
byte comparison, and CA-backed PostgreSQL connection path still require an
exact-current disposable rehearsal before production B2. Production B1 and B2
also require matching PostgreSQL 17 tools plus an independently reviewed
Supabase CA file and digest; this Mac does not yet have those tools or the
reviewed CA/rehearsal. The exact CA and `verify-full` path must be rehearsed
against the supported port-5432 connection mode selected for the run, and both
frozen direct and session-pooler shapes when both are network-reachable. Follow
Supabase's [SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement)
and [psql connection](https://supabase.com/docs/guides/database/psql) guidance.

Use the two maintenance windows in
`docs/operations-hub/PRODUCTION-0020-0024-EXECUTION-PACKET.md`. B1 pauses the
Hub Vercel deployment only long enough to drain writers, capture a dump and
read-only exports, and resume. B2 pauses it again for the exact live-set check,
fresh dump and re-export, atomic migration, history repair, and direct database
proofs. Keep B2 continuously paused and drained from the fresh re-export through
apply and proof; do not reopen a writer between the bound snapshot and commit.
Password login and Office app checks run only after resume because a paused
Vercel deployment returns 503. Re-pause immediately if one fails.

Take the unique, protected backup required by
`docs/operations-hub/HOSTED-MIGRATION-0017-0024-RUNBOOK.md` before exporting or
changing data.

## 2. Inventory and export

Run the checked-in target-bound exporter against the frozen production target:

```sh
export YLL_SUPABASE_SSL_ROOT_CERT="<absolute protected downloaded Supabase CA path>"
export YLL_EXPECTED_SUPABASE_SSL_ROOT_CERT_SHA256="<reviewed 64-lowercase CA SHA-256>"
install -d -m 700 "$YLL_MIGRATION_SECURE_DIR/review"
node scripts/export-0020-production-review.mjs \
  --directory "$YLL_MIGRATION_SECURE_DIR/review"
```

The target helper validates that protected regular file and exact digest before
starting a database child. It sanitizes each production libpq environment and
sets `PGSSLMODE=verify-full` plus `PGSSLROOTCERT` to the reviewed absolute path.
Do not rely on `sslmode=require` or the system default certificate store.

It uses one repeatable-read, read-only transaction and exports these six exact
artifact classes by UUID:

1. every `weekly_digests.id`;
2. every `brain_reviews.id`;
3. every `playbook_proposals.id`;
4. every `playbook_versions.id` where `source = 'edited'`;
5. every unsafe personal-touch ID selected by 0020's canonical
   `$legacy_personal_touch_provenance_preflight$` predicate;
6. every orphan `call_scores.id` whose `transcript_id` has no matching
   `transcripts.id`.

Export the complete matching rows to the protected deployment directory. Also
export:

- every affected `verticals` row and every retained generated playbook version
  needed as an active-version fallback;
- every `feedback_cards` row whose `call_score_id` is one of the reviewed
  orphan scores. These rows are explicit collateral and are deleted before the
  orphan scores instead of relying on an invisible cascade.

The exporter also captures every required fallback/collateral row, the exact
artifact and identity manifests, six counts, and structural/identity preflight.
Its protected,
deterministically sorted `identity-backfill-map.csv` binds each current
`app_users` employee ID to the normalized email, legacy/backfilled roles,
legacy timestamp, and exact matching Auth UUID that canonical `0023` will
backfill. Never print, paste, or attach that mapping to an ordinary ticket or
log.

The exporter writes 14 CSV outputs in a fixed filename order plus
`export-file-digests.sha256`. That index records the SHA-256 of every CSV; the
SHA-256 of the index itself is the **export-set SHA-256** printed by the exporter
success marker. The 15 protected files are one evidence set. It refuses
staging, an unsafe directory, and existing output. Complete-row CSVs and the
identity map can contain employee or customer information. Never place them in
the repository or deployment logs. Record only approved digests, counts, and
PII-free summaries in the ticket. Do not replace the checked-in predicates
with operator-authored queries.

## 3. Human classification and manifest

A second person must review the exports. In protected storage, that reviewer
must privately verify the exact `app_users` employee ID, normalized email,
legacy/backfilled role, legacy timestamp, and Auth UUID rows in
`identity-backfill-map.csv`; mapping contents never enter chat, logs, or the
ticket. The separate protected `reviewed-identity-backfill.csv` is the
deterministic machine manifest for that reviewed mapping. Record its SHA-256,
not its contents. This packet requires the frozen edited playbook count to
remain zero. If a later capture finds an edited version, stop. Classification
and recreation require a separate exact authorization; neither action is
included here.

Review the exporter-created PII-free manifest in the protected deployment
directory. Its first line must be exactly:

```csv
artifact_class,id
```

Allowed classes are closed:

- `weekly_digest`
- `brain_review`
- `playbook_proposal`
- `edited_playbook_version`
- `unsafe_personal_touch`
- `orphan_call_score`

Every later line is exactly `<artifact_class>,<lowercase canonical UUID>`.
Quotes, extra columns, blank interior rows, malformed UUIDs, unsupported
classes, and duplicate pairs are forbidden. Sort by `artifact_class,id`, end
the file with one newline, and record its SHA-256 in the deployment ticket. A
header-only manifest is valid only when all six locked live sets are empty.

B2 authorization binds the reviewed Supabase CA SHA, export-set SHA,
identity-manifest SHA, artifact-manifest SHA, six counts, and driver SHA. After
the fresh B2 dump, copy the export-set digest from that authorization and use
the exporter's machine gate in a new empty protected review directory:

```sh
YLL_MIGRATION_EXPORT_SET_SHA256="<exact export-set SHA from B2 authorization>"
YLL_MIGRATION_B2_REVIEW_DIR="$YLL_MIGRATION_SECURE_DIR/review-b2"
install -d -m 700 "$YLL_MIGRATION_B2_REVIEW_DIR"
node scripts/export-0020-production-review.mjs \
  --directory "$YLL_MIGRATION_B2_REVIEW_DIR" \
  --expected-export-set-sha256 "$YLL_MIGRATION_EXPORT_SET_SHA256"
```

Do not recompute and trust a new digest from the fresh files. A mismatch fails
before any database write and leaves the protected output available for review.
Keep Vercel paused and drained from this re-export through apply, history
repair, and direct database proof.

## 4. One-transaction reconciliation and migration

Generate the apply file into the same unique protected directory:

```sh
node scripts/prepare-0020-hosted-apply.mjs \
  --manifest "$YLL_MIGRATION_SECURE_DIR/review/reviewed-metric-artifacts.csv" \
  --identity-manifest "$YLL_MIGRATION_SECURE_DIR/review/reviewed-identity-backfill.csv" \
  --output "$YLL_MIGRATION_SECURE_DIR/0020-0024-hosted.sql"
```

The generator validates both machine manifests before producing SQL. The
generated transaction:

- takes a transaction advisory lock and a fixed table-lock order;
- imports both reviewed manifests into temporary constrained tables;
- creates the locked current six-class set using the canonical 0020
  predicates;
- compares both the locked identity backfill and the six artifact classes in
  both directions against their reviewed manifests;
- calculates and verifies a generated-version fallback for every active
  reviewed edited playbook;
- explicitly deletes reviewed feedback-card children;
- deletes only reviewed IDs, with a row-count assertion for every class;
- applies byte-identical canonical migration bodies 0020 through 0024;
- runs the two reusable provenance assertions and schema postconditions;
- commits once.

Apply it only through the checked-in target-bound wrapper, which invokes
`psql` with stop-on-error and suppresses hosted connection details:

```sh
YLL_MIGRATION_DRIVER_SHA256="<exact driver SHA from B2 authorization>"
node scripts/guarded-supabase-db.mjs apply \
  --file "$YLL_MIGRATION_SECURE_DIR/0020-0024-hosted.sql" \
  --sha256 "$YLL_MIGRATION_DRIVER_SHA256"
```

Copy that digest from the independently reviewed B2 ticket. Do not calculate
and trust a new digest from an unreviewed file at apply time. The wrapper hashes
the same no-follow bytes it sends to `psql`, reconstructs the expected driver
from the embedded strict identity/artifact manifests plus pinned preamble and
migrations, rejects any non-generated input, revalidates the protected CA and
authorized digest, sets `PGSSLMODE=verify-full` and `PGSSLROOTCERT`, and prints
only a success marker.

There is no standalone quarantine commit. A wrong, missing, or stale ID, an
unreviewed row, a missing edited-playbook fallback, or any later migration
failure rolls back the quarantine, fallback update, and all 0020-0024 DDL.

## 5. Postconditions

With writers still paused:

1. Re-run all six inventory queries. Every set must be empty.
2. Run `select public.assert_legacy_metric_artifacts_reconciled();`.
3. Run `select public.assert_personal_touch_metric_provenance();`.
4. Prove the complete public schema matches canonical migrations with the
   history helper's host PostgreSQL 17 full public schema-only byte comparison
   in `scripts/reconcile-0020-0024-hosted-history.mjs`. The helper compares the
   local canonical shadow and production dumps in memory before and after
   history repair, normalizing only their two version banners. It creates no
   new schema snapshot artifact or digest.
5. Confirm the edited-playbook set remains empty. Never restore reviews,
   digests, proposals, edited versions, unsafe touches, orphan scores, or their
   feedback cards under this packet.

## Rollback

Before commit, the generated transaction rolls back automatically on failure.
After commit, restore the protected dump into a new database and investigate
there. Never blindly reinsert the exports into the live database because that
recreates the provenance defect this procedure removes.
