# Operations Hub Phase 0 safety checklist

Status: **foundation started; field-user provisioning blocked**
Date: 2026-08-07
Branch base: Hub `master@a317e66c3f13c0d4b22c68d40810fc2c3d794c32`

This checklist records the actual repository baseline and the safety gates that
must precede Advertising or Installer accounts. It does not authorize Hub-owned
copies of Quote Tool time, pay, payroll, job, or shared-labor data.

## 1. Release stop

Do **not** provision Advertising or Installer identities yet. The current app
was built for a small office allowlist:

- login is email/password, while the planned Operations Hub identity is phone
  number plus OTP;
- `src/proxy.ts` authorizes an email by presence in `app_users`, not by a
  department/capability model;
- most pages and APIs rely only on that global allowlist, so a newly allowlisted
  field employee could reach office-only surfaces;
- `app_users.role` is unconstrained, and existing `role !== 'rep'` checks can
  turn an unexpected role string into elevated access;
- all 31 tables defined by the checked-in migrations lack RLS policies, and the
  server commonly uses a service-role client that bypasses future RLS.

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
      before Supabase is called. The matcher excludes only Next internals and
      the known favicon, so dotted dynamic IDs cannot skip the gate. There is
      no missing-configuration bypass, including in local development.
- [ ] `app_users.role` is replaced or constrained; arbitrary values never imply
      privilege.
- [ ] One centralized actor resolver returns immutable employee ID, active
      status, memberships, active department context, and explicit capabilities.
- [ ] Every page and API endpoint declares required capabilities server-side.
- [ ] Existing office routes are denied to Advertising and Installer roles.
- [ ] Owner/Admin is provisioned only for Naldo and Jason in V1.
- [ ] Manager capabilities are testable but Manager remains unprovisioned.
- [ ] Phone OTP, invite, recovery, phone reassignment, deactivation, and session
      revocation rules are implemented and audited.
- [ ] Codex-side decisions 16 (OTP provider/recovery), 18 (cached-session and
      deactivated-device behavior), and 20 (placement/photo visibility) receive
      owner rulings before their affected auth/RLS behavior is implemented.
- [ ] P18 cached-session grace and deactivated-device pending-write behavior is
      owner-ruled, then implemented and audited. Until then, field provisioning
      remains blocked; the Hub must not silently accept or drop queued writes.
- [ ] Five public cron routes use authenticated requests rather than
      `CRON_ENABLED` alone.
- [ ] Legacy `src/lib/quoteTool.ts` remains read-only; new integration uses only
      the canonical `/api/ops/v1` boundary.

Baseline audit: 72 API route files exist; only 12 explicitly resolve a role.
Authorization coverage must be inventoried endpoint-by-endpoint before any
field identity is enabled.

## 4. Existing-table RLS checklist

Baseline in all checked-in migrations for the 31 tables below: RLS is not
enabled, no policies are defined, and no impersonated-role database tests
exist. The live Supabase database was not inspected in this audit. The
application primarily uses a service-role client, so API capability checks
remain mandatory even after RLS is added.

For each table, check all four gates before marking complete: RLS enabled;
anonymous/authenticated default-deny verified; least-privilege policies (if any)
reviewed; impersonated-role tests passing.

| Table | RLS | Default deny | Reviewed policies | Impersonation tests |
|---|---|---|---|---|
| `app_users` | [ ] | [ ] | [ ] | [ ] |
| `contacts_cache` | [ ] | [ ] | [ ] | [ ] |
| `ghl_sync_log` | [ ] | [ ] | [ ] | [ ] |
| `verticals` | [ ] | [ ] | [ ] | [ ] |
| `playbook_versions` | [ ] | [ ] | [ ] | [ ] |
| `documents` | [ ] | [ ] | [ ] | [ ] |
| `transcripts` | [ ] | [ ] | [ ] | [ ] |
| `learnings` | [ ] | [ ] | [ ] | [ ] |
| `playbook_proposals` | [ ] | [ ] | [ ] | [ ] |
| `ingest_jobs` | [ ] | [ ] | [ ] | [ ] |
| `leads` | [ ] | [ ] | [ ] | [ ] |
| `calls` | [ ] | [ ] | [ ] | [ ] |
| `followups` | [ ] | [ ] | [ ] | [ ] |
| `events_log` | [ ] | [ ] | [ ] | [ ] |
| `live_sessions` | [ ] | [ ] | [ ] | [ ] |
| `coaching_events` | [ ] | [ ] | [ ] | [ ] |
| `brain_reviews` | [ ] | [ ] | [ ] | [ ] |
| `call_recordings` | [ ] | [ ] | [ ] | [ ] |
| `recording_sync_state` | [ ] | [ ] | [ ] | [ ] |
| `rubric_versions` | [ ] | [ ] | [ ] | [ ] |
| `call_scores` | [ ] | [ ] | [ ] | [ ] |
| `feedback_cards` | [ ] | [ ] | [ ] | [ ] |
| `weekly_digests` | [ ] | [ ] | [ ] | [ ] |
| `coach_settings` | [ ] | [ ] | [ ] | [ ] |
| `inbound_emails` | [ ] | [ ] | [ ] | [ ] |
| `email_reply_drafts` | [ ] | [ ] | [ ] | [ ] |
| `second_mile_touches` | [ ] | [ ] | [ ] | [ ] |
| `second_mile_scans` | [ ] | [ ] | [ ] | [ ] |
| `offer_versions` | [ ] | [ ] | [ ] | [ ] |
| `brain_insights` | [ ] | [ ] | [ ] | [ ] |
| `practice_sessions` | [ ] | [ ] | [ ] | [ ] |

Required impersonated identities: logged out, inactive, self, wrong department,
stale membership, unlinked identity, Office, Advertising, Installer,
Owner/Admin, and unprovisioned Manager.

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
4. RLS/default-deny migrations plus a real Supabase impersonation harness.
5. Additive Hub identity/audit/integration scaffolding.
6. Vendor Quote-owned schemas; add version health and deploy-skew smoke tests.
7. Only after all above gates: phone OTP and controlled field-user provisioning.

Payroll CSV remains separately blocked until the canonical contract defines the
required subtotal record type, stable pay-line ID, and subtotal field semantics.
