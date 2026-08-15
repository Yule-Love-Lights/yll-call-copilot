# Operations Hub Phase 0 safety checklist

Status: **RLS base-role gate merged; lead-work authorization in progress; field-user provisioning blocked**
Date: 2026-08-13
Branch base: Hub `master@7962a8f025186c54acab66d47c32e93991e59a30`
after the human-authorized merge of PR #43. The lead-work authorization slice
is on `codex/operations-hub-phase-0-lead-access`; it is not yet merged. Local
repository, database, build, and unauthenticated responsive-smoke gates passed
on 2026-08-13; CI, human review, hosted checks, and authenticated production
smokes remain.

This checklist records the actual repository baseline and the safety gates that
must precede Advertising or Installer accounts. It does not authorize Hub-owned
copies of Quote Tool time, pay, payroll, job, or shared-labor data.

## 1. Release stop

Do **not** provision Advertising or Installer identities yet. The current app
was built for a small office allowlist:

- login is email/password, while the planned Operations Hub identity is phone
  number plus OTP;
- the new actor resolver still uses `app_users` as a bootstrap identity source;
  its inferred membership has no canonical `membership_version` or Quote-owned
  active-context projection;
- owner/admin runtime access now requires the server-only Naldo/Jason Auth UUID
  ceiling and audited team access on the protected call/live resources, but
  production IDs and the final additive employee/auth link still need review;
- route policies now inventory resource scope, but remaining service-role
  handlers and the hosted database rollout still need the authorization gates
  below;
- Merged PR #43 enables and forces RLS on all 31 baseline tables with zero
  client policies and removes client schema/table/column/sequence access. The
  server still uses a service-role client that bypasses RLS, so the handler
  resource audit remains
  a field-launch gate.

The current lead-work branch addresses the known Office lead/call resource
gaps. It adds immutable employee identifiers to claims and calls, self-claim
and self-call transaction boundaries, current HighLevel contact and channel
permission checks, append-only live segments, idempotency keys, durable
follow-up send state, and positive metric provenance. These are branch facts,
not release evidence, until the branch gates pass and a human merges it.

Customer live calling is positively disabled with
`LIVE_CUSTOMER_CALLS_ENABLED=false`. Runtime preflight rejects enabling it and
the bridge refuses to start. The complete activation evidence is listed in
`LIVE-CALLING-ACTIVATION-BLOCKERS.md`.

Customer call follow-up sending is also positively disabled with
`GHL_FOLLOWUP_SEND_ENABLED=false`, and runtime preflight rejects enabling it. It stays
off until the Hub can refresh a changed recipient and reconcile a provider-
accepted message whose final Hub status write was lost, without risking a
duplicate send.
The older customer-facing cold-snap check-in sender is disabled for the same
reason. Crew-only reveal-photo instructions remain available because they do
not contact customers.

Field provisioning remains blocked until the capability, API-authorization,
RLS, and impersonated-role gates below pass.

## 2. Contract and repository boundary

- [x] Quote Tool PR #701 established the `v1.3.0-draft` baseline; PR #716
      merged its self-contained canonical form to Quote Tool `master` at
      `5d56ebb62e23b2fe592cdc1912359b1ddf137270`.
- [x] Hub mirror is exact: 41,336 bytes, SHA-256
      `2fc10d33bf592b79d38741e8f40bdc1abcf52c2233d3be89521807211bbafa4a`.
- [x] `contract-pin.json` records one version, source commit/path, byte length,
      and raw-byte SHA-256.
- [x] Local verification detects mirror/pin drift and clearly reports
      `LOCAL_PIN_OK`; this is not represented as cross-repository trust.
- [x] Local cross-repository verification against a separate Quote Tool clone
      reports `CROSS_REPO_BYTES_OK` and rejects same-file/hardlink shortcuts.
- [ ] Quote Tool publishes `docs/context/ops-contract-schema/` canonically.
- [ ] Hub vendors the schema/OpenAPI files byte-identically.
- [ ] A required authenticated CI job fetches the Quote file at the pinned
      commit and compares it as data without executing PR-authored code.
- [ ] Contract, schema, and supported-version deploy smoke fails closed on skew.

The cross-repository CI job needs a read-only GitHub App or fine-grained token
that can read the private Quote repository. It must live in a trusted workflow,
must not use `pull_request_target` to execute PR code, and must fail—not skip—if
credentials are absent. Until that credential path is approved, CI performs
only the honestly named local pin check.

## 3. Identity and API authorization

- [x] Production configuration fails closed when Supabase auth or authorization
      dependencies are missing. The request-time resolver rejects blank,
      partial, malformed, and insecure production configuration; protected
      pages and all non-health APIs return generic non-cacheable 503 responses
      before Supabase is called. The matcher excludes only Next internals; the
      favicon passes through an exact public-runtime asset registry, so dotted
      dynamic IDs cannot skip the gate. There is
      no missing-configuration bypass, including in local development.
- [x] `app_users.role` is constrained at every authorization boundary; a closed
      parser, compatibility helpers, and the bootstrap script ensure arbitrary
      values never imply privilege.
- [x] A centralized email-linked bootstrap actor resolver returns the current
      `app_users.id`, row-presence status, inferred membership,
      null/version-marked active-context fields, and explicit Hub-local
      capabilities. It is intentionally not described as final immutable
      identity linkage.
- [ ] Additive Hub identity plus the Quote-owned current-context projection
      replace those bootstrap inferences with effective active state,
      memberships, `membership_version`, and canonical context freshness.
- [x] Every current page and API handler method declares required capabilities
      server-side; an exhaustive filesystem test rejects undeclared additions.
- [x] Existing office routes are denied to Advertising and Installer roles.
- [ ] Owner/Admin is provisioned only for Naldo and Jason in V1.
      Runtime access already fails closed against
      `HUB_OWNER_ADMIN_AUTH_USER_IDS`, and the generic bootstrap script cannot
      create an elevated role; this remains unchecked until the two production
      UUIDs and audited provisioning record are verified.
- [x] Manager is present in the closed design vocabulary and negative tests but
      every Manager actor claim is denied in V1.
- [ ] Merge the locally verified lead-work authorization slice. Its implementation
      binds claims and calls to immutable employee IDs; allows an ordinary
      Office employee to work only their active claim; makes Owner/Admin team
      reads explicit and audited; rechecks the current HighLevel contact,
      recipient, channel DND, tags, and stage before new customer work; and
      uses transactionally locked, idempotent database routines for lead,
      call, live-session, segment, and follow-up mutations.
- [ ] Complete the separate historical derived-data repair. Adding
      `metric_scope` and positively filtering new reads prevents future
      training/practice contamination, but previously materialized weekly
      digests, brain reviews, proposals, feedback, and other derived records
      must be audited and then rebuilt or invalidated before their release use.
      Migration `0020` now fails closed while any legacy weekly digest, brain
      review, playbook proposal, or potentially proposal-applied `edited`
      playbook version remains. Before retrying, an operator must export those
      rows, remove the reviews/digests/proposals and edited versions, reset each
      affected `verticals.active_version` to a retained generated version, and
      recreate only verified manual edits after migration. There is no bypass
      because legacy rows do not carry enough provenance for safe automation.
      The disposable migration fixture lives in
      `supabase/tests/migration/0020_metric_scope_backfill.seed.sql` with its
      pgTAP assertions beside it. Run migrations `0001` through `0019`, apply
      the seed, apply `0020`, then run the backfill test. It intentionally stays
      outside the ordinary post-migration test folder because its legacy rows
      omit columns that become mandatory in `0020`.
- [ ] Phone OTP, invite, recovery, phone reassignment, deactivation, and session
      revocation rules are implemented and audited.
- [ ] Codex-side decisions 16 (OTP provider/recovery), 18 (cached-session and
      deactivated-device behavior), and 20 (placement/photo visibility) receive
      owner rulings before their affected auth/RLS behavior is implemented.
- [ ] P18 cached-session grace and deactivated-device pending-write behavior is
      owner-ruled, then implemented and audited. Until then, field provisioning
      remains blocked; the Hub must not silently accept or drop queued writes.
- [x] Five cron routes require Vercel's `Authorization: Bearer $CRON_SECRET`
      credential before evaluating the separate `CRON_ENABLED` kill switch.
- [x] The preparatory outbound Twilio path uses an actor-bound, expiring,
      one-time database
      grant; destination/session are derived server-side and customer-local
      calling hours are rechecked before atomic consumption.
- [x] The public Media Streams upgrade validates Twilio's signature against a
      unique session-bound `wss://` path, rejects replay, and requires a
      matching first `start` event before opening Deepgram.
- [x] HighLevel signed webhook retries/replays are race-safely deduplicated by
      a persisted unique source digest.
- [ ] Production preflight and signed postdeploy smoke are run for cron,
      HighLevel, Twilio, and the live bridge. `npm run verify:auth-config`
      validates variable presence/shape before deploy. Customer live calling
      remains disabled until every gate in
      `LIVE-CALLING-ACTIVATION-BLOCKERS.md` is implemented, tested with real
      providers and browsers, reviewed, and approved.
- [ ] Legacy `src/lib/quoteTool.ts` remains read-only; new integration uses only
      the canonical `/api/ops/v1` boundary.

Current branch inventory includes 24 pages and 74 API route files (81 handler
methods), all declared in `src/lib/auth/routePolicy.ts`. The 12 legacy
route-level role lookups now return only closed least-privileged values. See
`PHASE-0-AUTHORIZATION-INVENTORY.md` for the capability matrix and remaining
resource-scope, audit, identity-projection, and cross-repository gaps.

## 4. Existing-table RLS checklist

PR #43 establishes an API-only database boundary for the 31 baseline tables.
Clean CI applies every migration to a fresh Supabase PostgreSQL database and
uses real `SET ROLE` pgTAP tests. It also rejects unreviewed application views,
routines, triggers, policies, publications, tables, and sequences.

The `Policy review` column is checked because the reviewed policy set is
intentionally empty. The `Base-role test` column covers `anon`,
`authenticated`, and `service_role`, including a temporary-grant test that
proves RLS independently of ACLs.

| Table | RLS + FORCE | Client default deny | Policy review | Base-role test |
|---|---|---|---|---|
| `app_users` | [x] | [x] | [x] | [x] |
| `contacts_cache` | [x] | [x] | [x] | [x] |
| `ghl_sync_log` | [x] | [x] | [x] | [x] |
| `verticals` | [x] | [x] | [x] | [x] |
| `playbook_versions` | [x] | [x] | [x] | [x] |
| `documents` | [x] | [x] | [x] | [x] |
| `transcripts` | [x] | [x] | [x] | [x] |
| `learnings` | [x] | [x] | [x] | [x] |
| `playbook_proposals` | [x] | [x] | [x] | [x] |
| `ingest_jobs` | [x] | [x] | [x] | [x] |
| `leads` | [x] | [x] | [x] | [x] |
| `calls` | [x] | [x] | [x] | [x] |
| `followups` | [x] | [x] | [x] | [x] |
| `events_log` | [x] | [x] | [x] | [x] |
| `live_sessions` | [x] | [x] | [x] | [x] |
| `coaching_events` | [x] | [x] | [x] | [x] |
| `brain_reviews` | [x] | [x] | [x] | [x] |
| `call_recordings` | [x] | [x] | [x] | [x] |
| `recording_sync_state` | [x] | [x] | [x] | [x] |
| `rubric_versions` | [x] | [x] | [x] | [x] |
| `call_scores` | [x] | [x] | [x] | [x] |
| `feedback_cards` | [x] | [x] | [x] | [x] |
| `weekly_digests` | [x] | [x] | [x] | [x] |
| `coach_settings` | [x] | [x] | [x] | [x] |
| `inbound_emails` | [x] | [x] | [x] | [x] |
| `email_reply_drafts` | [x] | [x] | [x] | [x] |
| `second_mile_touches` | [x] | [x] | [x] | [x] |
| `second_mile_scans` | [x] | [x] | [x] | [x] |
| `offer_versions` | [x] | [x] | [x] | [x] |
| `brain_insights` | [x] | [x] | [x] | [x] |
| `practice_sessions` | [x] | [x] | [x] | [x] |
| `live_segments` | [x] | [x] | [x] | [x] |

The lead-work branch authors RLS, default-deny coverage, an append-only
service-role grant, and impersonation tests for `live_segments`, which becomes
the 32nd table. Its local database suites passed on 2026-08-13: 117 lead-work
assertions, 259 default-deny assertions, and 18 migration-backfill assertions.
CI and human merge remain required.

Claims shaped like inactive, self, wrong-department, stale-membership,
unlinked, Office, Advertising, Installer, Owner/Admin, and Manager identities
are also verified unable to override database default deny. That is not the
semantic persona gate. The following remain blocked until the additive
identity and membership schema exists:

- [ ] immutable self-versus-other employee tests;
- [ ] active/inactive and linked/unlinked identity tests;
- [ ] current/stale multi-membership and department-context tests;
- [ ] Office, Advertising, Installer, Owner/Admin, and unprovisioned Manager
      server-plus-database integration tests;
- [ ] hosted owner/ACL/policy/routine/trigger/publication preflight and
      PostgreSQL-major-version verification;
- [ ] full-stack PostgREST denial smoke with real `anon` and authenticated
      tokens.

See `PHASE-0-RLS-RUNBOOK.md` for the exact proof boundary and rollout steps.

## 5. Additive Hub-owned schema, after authorization design

Proposed names are reserved, not yet authorized migrations:

- `ops_employees`
- `ops_departments`
- `ops_employee_department_memberships`
- Hub-owned audit/outbox/inbox/DLQ and kill-switch records; only their
  cross-boundary envelope/event fields come from the Quote-owned shared JSON
  Schema after the Quote Tool publishes it

These tables must never contain a second day clock, break, job segment, travel
ledger, compensation result, pay-period close, or payroll export.

## 6. Phase 0 pull-request sequence

1. Contract pin/verifier, repository ownership guardrails, baseline CI, and
   this explicit release stop.
2. Production fail-closed configuration helper and tests.
3. Central actor/capability model; inventory and protect every existing page and
   API before field access.
4. RLS/default-deny migrations plus a real Supabase base-role impersonation
   harness (merged in PR #43; hosted and semantic-persona gates remain).
5. Lead-work resource authorization, mutation idempotency, current customer
   permission checks, and metric provenance (in progress on the current
   branch; local gates passed, while CI and human merge remain).
6. Additive Hub identity/audit/integration scaffolding.
7. Vendor Quote-owned schemas; add version health and deploy-skew smoke tests.
8. Only after all above gates: phone OTP and controlled field-user provisioning.

Payroll CSV remains separately blocked until the canonical contract defines the
required subtotal record type, stable pay-line ID, and subtotal field semantics.
