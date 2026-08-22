# Operations Hub final-review pack

Status: **owner-approved planning baseline; staging rehearsal and shared password login verified; new production execution packet prepared for review but not authorized; field provisioning blocked**
Updated: 2026-08-22
Merged Hub source audited through Office task release rehearsal PR #71:
`master@c1c9146810007d16b47d669f7506b486e0f6733f`. In addition to the Phase 0
baseline through PR #61, this includes the Management shell in PR #62, shared
Quote Tool password identity in PR #64, the Office shell/dashboard in PRs #65
and #67, Railway retirement in PR #69, and the Office task foundation in the
later-merged PR #68. PR #71 then pinned the timestamped Office migration into
the release-rehearsal guard. The current contract and schema artifact pins are
recorded in `SOURCE-PINS.md`.

This pack contains the reconciled, owner-approved Operations Hub planning
baseline. The new production execution packet is a proposed operational
procedure and is not covered by that prior approval. Quote Tool PR #701
established the original canonical baseline, PR #716 made it self-contained,
Naldo signed the master plan, and Hub PR #37 was human-merged.
The current byte-identical mirror is `v1.5.0-draft`, pinned to Quote Tool
commit `1445c5201f227474321809e0b64dfdb60f81b731`. Its independent schema
version is `1.1.0-draft`.

## Read in this order

1. `DECISIONS.md` — owner rulings and binding legal/display constraints.
2. `MASTER-PLAN.md` — one system plan across both repositories.
3. `OPERATIONS-HUB-SPEC.md` — normative employee and administrator behavior in
   the Hub.
4. `INTEGRATION-CONTRACT.md` — byte-identical mirror of the merged Quote Tool
   canonical contract.
5. `ops-contract-schema/` — byte-identical canonical manifest, OpenAPI, and
   generated JSON Schema artifacts.
6. `CONTRACT-V1.3-PROPOSAL.md` — historical proposal retained for audit; it
   is not authoritative.
7. `FINAL-REVIEW-FINDINGS.md` — persona and cross-repository failure review.
8. `FEATURE-BACKLOG.md` — committed scope, launch blockers, and later ideas.
9. `SOURCE-PINS.md` — the exact source revisions reconciled here.
10. `CLAUDE-FINAL-REVIEW-HANDOFF.md` — historical final-review prompt.
11. `PHASE-0-CHECKLIST.md` — live safety gates and the field-provisioning stop.
12. `PHASE-0-AUTHORIZATION-INVENTORY.md` — current Hub-local actor, route,
    machine-auth coverage, deployment requirements, and remaining release
    blocks.
13. `PHASE-0-RLS-RUNBOOK.md` — the API-only database boundary, CI proof,
    hosted preflight, safe rollout order, and remaining identity tests.
14. `HOSTED-MIGRATION-0017-0024-RUNBOOK.md`: the measured hosted drift,
    production-shaped rehearsal, exact reconciliation, migration-history
    repair, and deferred recording boundary.
15. `PRODUCTION-0020-0024-EXECUTION-PACKET.md`: the exact later production
    authority boundary, entry gates, writer freeze, artifacts, stops, and exit
    proof. It is not production-write authorization.
16. `LIVE-CALLING-ACTIVATION-BLOCKERS.md`: the positive customer-call kill
    switch and the evidence required before live calling may be enabled.
17. `QUOTE-LIFECYCLE-TASK-INTEGRATION-REQUIREMENTS.md`: approved Quote Tool
    prerequisites for real Office timing, workload, and quote-origin task
    data; it is not a canonical-contract amendment.

## Scoped authority

`INTEGRATION-CONTRACT.md` governs all cross-repository schemas, commands,
events, canonical time, pay, and Quote Tool facts. `DECISIONS.md` records
Naldo's dated product rulings; a ruling that changes contract-owned behavior is
not implementation authority until incorporated into the canonical contract
under section 10 and mirrored byte-identically. `MASTER-PLAN.md` governs shared
delivery, and `OPERATIONS-HUB-SPEC.md` governs Hub-only behavior. Any conflict
stops work at the affected boundary.

No implementation may guess at wages, privacy, surveillance, permissions, or
source-of-truth ownership.

## Phase 0 state

Completed:

- Quote Tool PR #701 established the canonical `v1.3.0-draft` baseline and
  PR #716 merged the self-contained canonical contract.
- Naldo's four P16 rulings are recorded in `DECISIONS.md`.
- Naldo signed the master-plan approval and authorized Phase 0.
- The Hub contract, manifest, OpenAPI, and JSON Schema mirrors are
  byte-identical to the Quote Tool canonical files.
- Fail-closed production auth, centralized capabilities, API-only database RLS,
  and Office lead/call resource authorization merged through PR #46.
- Hub PR #50 merged the immutable employee, versioned Auth-link, department
  membership, identity-audit, and guarded compatibility-projection foundation.
  Its application, migration-order, pgTAP, build, and Vercel checks passed.
- Hub PR #52 merged the disabled preview-only Phone Auth request/verify path,
  Turnstile token submission, fail-closed session-age enforcement, recording
  sync safeguards, and commitment extraction. Provider activation, recovery,
  reassignment, and password/session revocation remain open.
- The staged shared-credentials bridge is documented in
  [`SHARED-QUOTE-IDENTITY-ROLLOUT.md`](SHARED-QUOTE-IDENTITY-ROLLOUT.md). It
  uses explicit, auditable Quote Tool Auth UUID mappings while keeping Hub
  roles and authorization independent. Staging now uses it successfully for
  the approved mapped users' existing email/password login. Its mappings must
  remain static; revocation/replacement and production activation are blocked
  on source-aware transaction checks and owner-attributed replacement audit.
- Quote Tool PR #803 published the canonical contract/schema pack, and Hub PR
  #53 vendored it byte-identically. Hub PR #54 established the original
  assistant-managed merge-rule baseline; this H0 update extends it with the
  authenticated-byte bootstrap and four-mode order rules.
- Hub PR #57 reconciled the release ledger. PR #60 merged the fail-closed
  tooling and runbook without writing staging or production data; it
  superseded closed, unmerged PR #56. The later protected staging rehearsal
  passed at PR #60's merge revision. PR #58
  merged test-only local persona coverage, bringing the identity suite to 53
  assertions and default-deny to 307. Real-token persona proof remains open.
- Trusted cross-repository byte CI is active with a fine-grained
  `OPS_HUB_QUOTE_TOOL_READ_TOKEN` restricted to Contents: read on the Quote
  Tool repository. Its first `master` run succeeded after PR #61. The Hub's
  pure compatibility checker fails closed on missing, malformed, or
  unsupported versions; it is not live remote version-health proof.
- Production migration `0019` was applied out of band and verified across the
  31 existing hosted public tables. Production migrations `0020` through
  `0024` remain unapplied. The separate `yll-ops-hub-staging` Supabase project
  passed both the clean `0001` through `0024` target and the production-shaped
  `0019` through `0024` reconciliation rehearsal. The `0024` target is 38
  tables, 30 routines, and 12 triggers. Staging subsequently applied `0025`
  and now has 39 tables, 33 routines, and 13 triggers, with forced RLS, zero
  client policies, and no `anon` or `authenticated` application-table access.
  It has not applied `20260821141530_office_tasks.sql`. The current clean local
  and CI target applies all 26 checked-in migrations and contains 41 tables, 37
  routines, and 15 triggers.
- Staging public signup is off, its session timebox is 30 days, and its access
  token lifetime is 15 minutes. Production application remains separately
  blocked on PostgreSQL 17 client and Docker availability, a protected reviewed
  Supabase CA and exact-current CA-backed helper rehearsal, B1
  dump/export/restore proof, independent
  export-set/identity-manifest/artifact-manifest/driver review, separate B2
  authorization, and post-apply proof.

Phase 0 must now deliver:

- Authenticated Quote Tool runtime version health and live deploy-skew proof.
- RLS/authorization checklists and impersonated-role tests are defined for
  every field-facing Hub table and endpoint.
- The reviewed production `0020` through `0024` rollout, hosted persona proof,
  idempotency, DLQ, kill-switch, and fail-closed activation gates. Production
  application of `0025_quote_tool_identity_bridge.sql` and
  `20260821141530_office_tasks.sql` is excluded from that packet and remains
  separate deferred work. Identity replacement, phone provider configuration,
  recovery, reassignment, and password/session revocation also remain deferred
  under Decision 25 and the staging-only identity boundary.

Merged PR #50 adds Hub-owned immutable employee, auth-link, active-state,
membership-version, and local identity-audit scaffolding. PR #52 adds a
disabled preview-only Phone Auth and Turnstile application path plus the
30-day session-age check; it does not configure a provider or create field
accounts. PRs #803 and #53 publish and vendor the cross-boundary contract and
schema, but the runtime outbox, inbox, DLQ, supported-version envelope, and
Quote-owned current-context projection are not implemented. The long-term
approved target remains Supabase Phone Auth with Turnstile, Twilio Verify
delivery, owner-only recovery, password-identity revocation at activation with
Supabase-console owner break-glass, and a 30-day maximum Hub session. Decision
25 keeps the current invite-only email/password login and leaves the phone-auth
flag false while higher-priority migration, ledger, and persona work finishes.
Deployment preflight rejects a true phone-auth flag, any configured Turnstile
site key, and a missing, blank, or unknown `VERCEL_ENV`, so the deferred phone
and Turnstile path cannot be deployed while password login remains selected.
Placement Runs will require an
online start, allow at most 12 hours under an authorized offline window, and
quarantine expired or revoked-device work for Naldo/Jason review without
automatic pay or inventory credit. Management is an owner/admin view and
digest, not a paid-work department.

The fail-closed OTP application path is merged but disabled. The separate paid
staging database exists and its clean schema and default-deny target are
verified. Phone-provider activation is intentionally parked; a later owner
decision must resume the dedicated preview, provider delivery, CAPTCHA, SMS
limits, and phone-identity work. Field
provisioning, paid workflow, and production phone auth remain blocked on the
Quote-owned capability and current-context surfaces, hosted identity-persona
proof, recovery, and
password/session revocation. Naldo ruled the Advertising placement/photo
visibility boundary on 2026-08-18; implementation and hosted authorization
proof remain Advertising-phase work.

PRs #35 and #36 are closed as superseded. This reconciled pack, initially
merged by PR #37 and updated by later approved truth corrections, is the only
Hub planning source. Every implementation PR still requires current gates and
a new exact-head human merge authorization; the authorized assistant performs
the GitHub Ready and Merge actions.
