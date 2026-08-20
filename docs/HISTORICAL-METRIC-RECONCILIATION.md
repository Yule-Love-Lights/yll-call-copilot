# Historical metric reconciliation

Migration 0020 intentionally rejects legacy metric artifacts whose employee-
performance provenance cannot be proved. Do not relabel ambiguous history and
do not weaken the migration. The reviewed artifacts and canonical migrations
0020 through 0024 must commit in one transaction.

## 1. Required maintenance boundary

Test this entire procedure against a restored, sanitized staging copy first.
For staging and production, pause every cron, worker, deployment, and operator
path that can write calls, transcripts, scores, feedback cards, personal
touches, reviews, digests, proposals, playbooks, or verticals. Keep them paused
through migration-history repair and signed smokes.

Take the unique, protected backup required by
`docs/operations-hub/HOSTED-MIGRATION-0017-0024-RUNBOOK.md` before exporting or
changing data.

## 2. Inventory and export

Inventory these six exact artifact classes by UUID:

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

The exports can contain employee and customer information. Never place them in
the repository or deployment logs. Record row counts and an export checksum in
the deployment ticket.

## 3. Human classification and manifest

A second person must review the exports. Every edited playbook must be marked
as a verified manual edit to recreate after 0020 or as ambiguous history to
quarantine. An unproved edit stays quarantined.

Create one PII-free manifest in the protected deployment directory. Its first
line must be exactly:

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

## 4. One-transaction reconciliation and migration

Generate the apply file into the same unique protected directory:

```sh
node scripts/prepare-0020-hosted-apply.mjs \
  --manifest "$YLL_MIGRATION_SECURE_DIR/reviewed-metric-artifacts.csv" \
  --output "$YLL_MIGRATION_SECURE_DIR/0020-0024-hosted.sql"
```

The generator validates the manifest before producing SQL. The generated
transaction:

- takes a transaction advisory lock and a fixed table-lock order;
- imports the reviewed manifest into a temporary primary-key table;
- creates the locked current six-class set using the canonical 0020
  predicates;
- compares current minus reviewed and reviewed minus current;
- calculates and verifies a generated-version fallback for every active
  reviewed edited playbook;
- explicitly deletes reviewed feedback-card children;
- deletes only reviewed IDs, with a row-count assertion for every class;
- applies byte-identical canonical migration bodies 0020 through 0024;
- runs the two reusable provenance assertions and schema postconditions;
- commits once.

Apply it only with `psql` and stop on the first error:

```sh
psql "$SUPABASE_DB_URL" -X --set ON_ERROR_STOP=on \
  --file "$YLL_MIGRATION_SECURE_DIR/0020-0024-hosted.sql"
```

There is no standalone quarantine commit. A wrong, missing, or stale ID, an
unreviewed row, a missing edited-playbook fallback, or any later migration
failure rolls back the quarantine, fallback update, and all 0020-0024 DDL.

## 5. Postconditions

With writers still paused:

1. Re-run all six inventory queries. Every set must be empty.
2. Run `select public.assert_legacy_metric_artifacts_reconciled();`.
3. Run `select public.assert_personal_touch_metric_provenance();`.
4. Prove the complete public schema matches canonical migrations with the
   pinned Supabase schema-diff gate in
   `scripts/reconcile-0020-0024-hosted-history.mjs`.
5. Recreate only manually verified edits through the post-0020 application
   path. Never restore reviews, digests, proposals, unsafe touches, orphan
   scores, or their feedback cards.

## Rollback

Before commit, the generated transaction rolls back automatically on failure.
After commit, restore the protected dump into a new database and investigate
there. Never blindly reinsert the exports into the live database because that
recreates the provenance defect this procedure removes.
