# Operations Hub Phase 0 safety checklist

Status: **email/password remains active; staging database verified; phone-auth activation deferred; field-user provisioning blocked**
Date: 2026-08-20
Merged base: Hub `master@bad885dc85b5d2c255bad8567b21a83f6ab2d4ec`
after the human-authorized merges through PR #54. PR #50 merged the additive
identity foundation, PR #52 merged the disabled preview-only phone-auth path,
PR #53 vendored the canonical schema pack, and PR #54 is the current rule
baseline. Provider, persona, runtime integration, and field-launch gates remain
open.

This checklist records the actual repository baseline and the safety gates that
must precede Advertising or Installer accounts. It does not authorize Hub-owned
copies of Quote Tool time, pay, payroll, job, or shared-labor data.

## 1. Release stop

Do **not** provision Advertising or Installer identities yet. The current app
was built for a small office allowlist:

- login remains invite-only email/password under Decision 25. PR #52 added a fail-closed,
  preview-only Supabase Phone Auth request/verify path with Turnstile token
  submission and a 30-day session-age check, but it is disabled and no staging
  or production OTP provider is configured;
- merged PR #50 replaces email-linked `app_users` resolution with an
  active, revocable Auth-link record that resolves to a preserved
  `ops_employees.id`, effective active memberships, and a monotonic Hub
  `membership_version`. Each Auth UUID is immutable in its history record, but
  an owner-approved replacement can revoke the old link and add a new one
  without changing the employee ID. The Quote-owned active-context projection
  is still unavailable;
- owner/admin runtime access now requires the server-only Naldo/Jason Auth UUID
  ceiling and audited team access on the protected call/live resources, but
  staging Auth identities and the hosted employee/Auth links are not configured;
- route policies now inventory resource scope, but remaining service-role
  handlers and the hosted database rollout still need the authorization gates
  below;
- Merged PR #43 enables and forces RLS on all 31 baseline tables with zero
  client policies and removes client schema/table/column/sequence access. The
  server still uses a service-role client that bypasses RLS, so the handler
  resource audit remains
  a field-launch gate.

Production migration `0019` was applied out of band and verified on those 31
hosted public tables. Production migrations `0020` through `0024` remain
unapplied. The separate staging project has applied the clean `0001` through
`0024` sequence and verified the 38-table, 30-routine, 12-trigger default-deny
target. That clean-target proof does not replace the required
production-shaped reconciliation rehearsal.

Merged PR #46 addresses the known Office lead/call resource gaps. It adds
immutable employee identifiers to claims and calls, self-claim and self-call
transaction boundaries, current HighLevel contact and channel permission
checks, append-only live segments, idempotency keys, durable follow-up send
state, and positive metric provenance. Its application/database checks and
Vercel deploy passed before/after the human-authorized merge at `9000c683`.
Railway remained intentionally red because the disabled live-call bridge
correctly refused to start; this is not identity release evidence.

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

- [x] Quote Tool PR #701 established the `v1.3.0-draft` baseline and PR #716
      made it self-contained. The current canonical/mirror pin is
      `v1.4.0-draft` at Quote commit
      `c60bce4927a7fc47a8d6ee1d14a6eb88257755aa` after Quote Tool PR #803.
- [x] The paired Hub mirror copies the current contract exactly: 56,963 bytes,
      SHA-256 `d3551f65561863af42721d020b357888acc6c90eb0c8c586f7bc151305395e7f`.
- [x] `contract-pin.json` records one version, source commit/path, byte length,
      and raw-byte SHA-256.
- [x] Local verification detects mirror/pin drift and clearly reports
      `LOCAL_PIN_OK`; this is not represented as cross-repository trust.
- [x] Local cross-repository verification against a separate Quote Tool clone
      reports `CROSS_REPO_BYTES_OK` and rejects same-file/hardlink shortcuts.
- [x] Quote Tool publishes `docs/context/ops-contract-schema/` canonically at
      schema version `1.0.0-draft`.
- [x] Hub vendors the manifest, OpenAPI, and JSON Schema files
      byte-identically and pins each byte length and SHA-256.
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
- [x] `app_users` is a guarded Office compatibility projection. The closed
      parser, service-role-only atomic provisioning routine, and legacy helper
      ensure arbitrary input never implies privilege or provisions a field,
      Manager, or Owner/Admin account.
- [x] PR #50 implements the additive Hub identity resolver: immutable
      per-link Auth UUID history with explicit revocation/replacement, preserved
      Office employee UUIDs, effective active state, multi-department
      memberships, monotonic `membership_version`, and explicit Hub-local
      capabilities. Database, CI, independent review, and human-merge gates
      passed. Hosted persona and production-configuration proof remain below.
- [ ] The Quote-owned current-context projection is a separate canonical
      contract/API dependency and remains unavailable. The Hub actor therefore
      keeps `activeDepartmentContext = null` and cannot invent a paid-context
      ledger.
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
- [x] PR #46 merged the verified lead-work authorization slice. Its implementation
      binds claims and calls to immutable employee IDs; allows an ordinary
      Office employee to work only their active claim; makes Owner/Admin team
      reads explicit and audited; rechecks the current HighLevel contact,
      recipient, channel DND, tags, and stage before new customer work; and
      uses transactionally locked, idempotent database routines for lead,
      call, live-session, segment, and follow-up mutations.
- [ ] Complete the separate historical derived-data repair. Adding
      `metric_scope` and positively filtering new reads prevents future
      training/practice contamination, but the actual legacy blocker classes,
      including weekly digests, brain reviews, proposals, edited playbooks, and
      unsafe personal-touch rows, must be audited and then rebuilt, recreated,
      or invalidated before release use. Current feedback reads already require
      positively proven performance scores and are not an additional deletion
      class.
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
- [x] Owner architecture ruling for decision 16: invite-only Supabase Phone
      Auth, Turnstile on OTP request/resend/recovery, owner-only recovery, and a
      maximum 30-day Hub session. Twilio Verify is the planned delivery provider
      for a later activation PR, not enabled or configured by this foundation.
      Existing password identities are revoked at phone-auth activation;
      Supabase-console owner break-glass is the emergency path.
- [x] Decision 25 keeps invite-only email/password as the active interim login
      and defers phone OTP, Twilio Verify, Turnstile, recovery/reassignment,
      and password-identity revocation until a later owner activation decision.
      `HUB_PHONE_AUTH_STAGING_ENABLED` stays false.
- [x] PR #52 merged the fail-closed preview-only Phone Auth request/verify path,
      Turnstile token submission, `shouldCreateUser: false`, and the maximum
      30-day signed-session-age check. These application safeguards remain
      disabled while Decision 25 is in force.
- [ ] Invite provisioning, Twilio Verify delivery, hosted Turnstile
      verification, owner recovery, phone reassignment, deactivation,
      password/session revocation, abuse controls, and provider smokes are
      implemented and audited. Until then email/password bootstrap remains
      Office-only and no field account is provisioned.
- [ ] Before staging phone auth is enabled, resume the parked provider track.
      The separate staging Supabase project now exists, public signup is off,
      the session timebox is 30 days, and the access token lifetime is 15
      minutes. CAPTCHA, SMS delivery and rate limits, phone test identities,
      and the dedicated staging deployment remain unconfigured by decision.
      Generic Vercel Preview no longer carries the production Hub/Quote
      database credentials and its outbound switches remain false.
      The current proxy proves a signed OTP session and its age but does not
      query `auth.sessions` on every request, so revocation may lag until the
      access JWT expires. Production still requires audited password/session
      revocation and owner recovery.
- [ ] Before any Auth-link replacement or recovery path is enabled, every
      `0020` employee mutation routine atomically locks and verifies the current
      active Auth link against its supplied Auth UUID. The foundation has no
      reachable replacement routine; its guarded legacy Office provisioner
      refuses employees with link history. This gate prevents an already
      resolved old request from using a compatibility projection recreated for
      a replacement login.
- [ ] That future Owner/Admin replacement routine also records the acting
      employee, reason, old-link revocation, and new-link creation atomically.
      Direct Auth-link mutation remains unavailable to service/browser roles.
- [ ] Before any membership-change path is enabled, membership revocation must
      atomically remove/update the `app_users` compatibility projection or the
      `0020` mutation routines must verify the current effective membership.
      This foundation grants service/browser roles no membership writes, and
      its only provisioner creates Office membership before the Auth link.
- [x] Owner offline ruling for decision 18: a Placement Run must start online;
      the accepted run may authorize up to 12 hours of offline capture; expired,
      deactivated, revoked, or otherwise ineligible-device uploads quarantine
      for Naldo/Jason review and never automatically count toward pay or
      inventory.
- [ ] The 12-hour credential/grace behavior, deactivation receipt, quarantine,
      replay, and safe owner-resolution path are implemented and audited. The
      Quote-owned offline packet and current-context dependencies remain blocked.
- [x] Decision 20 placement/photo visibility is ruled: employees see their own
      exact placement evidence plus non-sensitive team totals, approved
      campaign coverage, hotspots, and avoid zones; only Naldo/Jason see every
      employee's exact placement evidence and route history.
- [ ] Track B enforces Decision 20 in API authorization, RLS/read models, maps,
      photos, notes, history, and impersonated-role tests before field launch.
- [ ] Before field actors are enabled, replace the Office-only required
      compatibility-email projection with an actor/attribution shape that lets
      phone-only Advertising and Installer identities resolve without inventing
      an email. The nullable database field alone is not activation evidence.
- [x] Management is an owner/admin view and digest type, not a department
      membership or paid-work context. V1 employee departments remain Office,
      Advertising, and Installer; Manager claims remain denied.
- [x] Six cron routes require Vercel's `Authorization: Bearer $CRON_SECRET`
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

## 4. Database RLS checklist

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
| `call_commitments` | [x] | [x] | [x] | [x] |
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
| `ops_departments` | [x] | [x] | [x] | [x] |
| `ops_employees` | [x] | [x] | [x] | [x] |
| `ops_employee_auth_identities` | [x] | [x] | [x] | [x] |
| `ops_employee_department_memberships` | [x] | [x] | [x] | [x] |
| `ops_identity_audit_events` | [x] | [x] | [x] | [x] |

Merged PR #46 adds RLS, default-deny coverage, an append-only service-role
grant, and impersonation tests for `live_segments`, the 32nd baseline table.
Before merge its database suites passed 117 lead-work assertions, 259
default-deny assertions, and 18 migration-backfill assertions; GitHub and hosted
checks were green.

Migration `0023` extends the reviewed manifest to 38 tables, 27 routines, and
12 triggers. The local PostgreSQL/parser harness applied all 24 migrations,
passed the seeded legacy upgrade, exact provisioning retry and deactivation
denial, and matched all four protective preflight failures. PR #50 CI passed
51 identity-foundation pgTAP assertions, the 304-assertion expanded
default-deny suite, the 117-assertion lead-work suite, and all seeded migration
upgrade/preflight jobs before merge.

Claims shaped like inactive, self, wrong-department, stale-membership,
unlinked, Office, Advertising, Installer, Owner/Admin, and Manager identities
are also verified unable to override database default deny. That is not the
semantic persona gate. PR #50 added database tests for preserved employee
UUIDs, active/inactive and linked/unlinked identity, projection drift,
deactivation/reactivation, exact provisioning retry/conflict/audit behavior,
the three-department vocabulary, and Manager's exclusion from departments.
The following still remain:

- [ ] immutable self-versus-other employee resource tests;
- [ ] current/stale multi-membership plus Quote-owned department-context
      integration tests;
- [ ] Office, Advertising, Installer, Owner/Admin, and unprovisioned Manager
      server-plus-database integration tests;
- [ ] hosted owner/ACL/policy/routine/trigger/publication preflight and
      PostgreSQL-major-version verification;
- [ ] full-stack PostgREST denial smoke with real `anon` and authenticated
      tokens.

See `PHASE-0-RLS-RUNBOOK.md` for the exact proof boundary and rollout steps.

## 5. Additive Hub-owned schema, after authorization design

PR #50 added Hub-owned versions of:

- `ops_employees`
- `ops_departments`
- `ops_employee_auth_identities`
- `ops_employee_department_memberships`
- `ops_identity_audit_events`

Quote Tool PR #803 published the canonical shared manifest, OpenAPI, and JSON
Schema, and Hub PR #53 vendored them byte-identically. Publication does not
implement the runtime outbox/inbox/DLQ, supported-version envelope, capability
grant transport, or Quote-owned current-context projection. Those remain Phase
0 dependencies at the repository boundary.

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
   permission checks, and metric provenance (merged in PR #46).
6. Additive Hub identity/audit/integration scaffolding (merged in PR #50) and
   disabled preview-only Phone Auth/Turnstile/session-age code (merged in PR
   #52; no provider activation or field provisioning).
7. Add authenticated cross-repository CI plus version-health and deploy-skew
   smoke tests for the vendored Quote-owned schemas.
8. Use the separate staging database to rehearse the production-shaped
   `0019` to `0024` migration, historical reconciliation, and hosted persona
   gates. Complete the migration, ledger, and synthetic persona PRs before
   resuming the phone-auth deployment-gate PR.
9. Keep invite-only email/password active and phone auth false. A later owner
   decision may resume the dedicated Vercel staging deployment, Twilio Verify,
   Turnstile, recovery, revocation, and real-phone smoke work. Field
   provisioning and paid workflows remain blocked by their independent gates.

Payroll remains Quote Tool-owned and separately gated by the contract's
overtime, blended-rate, professional-review, and owner-activation requirements.
