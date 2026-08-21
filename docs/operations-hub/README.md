# Operations Hub final-review pack

Status: **owner-approved; contract/schema mirror current; staging database verified; phone-auth activation deferred; field provisioning blocked**
Updated: 2026-08-20
Merged Hub source audited through PR #61:
`master@ba3ecc7fa0d6248353aa75fb79a75d549a2288ba`. This includes the approved
baseline through PR #54, release-ledger PR #57, migration-reconciliation PR
#60, and persona-coverage PR #58. The current contract and schema artifact
pins are recorded in `SOURCE-PINS.md`.

This pack is the reconciled and approved source for the Operations Hub.
Quote Tool PR #701 established the original canonical baseline, PR #716 made it
self-contained, Naldo signed the master plan, and Hub PR #37 was human-merged.
The current byte-identical mirror is `v1.4.0-draft`, pinned to Quote Tool PR
#803 merge `c60bce4927a7fc47a8d6ee1d14a6eb88257755aa`. Its independent schema
version is `1.0.0-draft`.

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
    repair, and recording-release procedure.
15. `LIVE-CALLING-ACTIVATION-BLOCKERS.md`: the positive customer-call kill
    switch and the evidence required before live calling may be enabled.

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
- Quote Tool PR #803 published the canonical contract/schema pack, and Hub PR
  #53 vendored it byte-identically. Hub PR #54 established the original
  assistant-managed merge-rule baseline; this H0 update extends it with the
  authenticated-byte bootstrap and four-mode order rules.
- Hub PR #57 reconciled the release ledger. PR #60 merged the fail-closed
  tooling and runbook for a later hosted migration rehearsal without writing
  staging or production data; it superseded closed, unmerged PR #56. PR #58
  merged test-only local persona coverage, bringing the identity suite to 53
  assertions and default-deny to 307. The hosted rehearsal and real-token
  persona proof remain open.
- Trusted cross-repository byte CI is active with a fine-grained
  `OPS_HUB_QUOTE_TOOL_READ_TOKEN` restricted to Contents: read on the Quote
  Tool repository. Its first `master` run succeeded after PR #61. The Hub's
  pure compatibility checker fails closed on missing, malformed, or
  unsupported versions; it is not live remote version-health proof.
- Production migration `0019` was applied out of band and verified across the
  31 existing hosted public tables. Production migrations `0020` through
  `0024` remain unapplied. The separate `yll-ops-hub-staging` Supabase project
  now has a clean `0001` through `0024` application with the expected 38
  tables, 30 routines, 12 triggers, forced RLS on all 38 tables, zero client
  policies, and no `anon` or `authenticated` application-table access.
- Staging public signup is off, its session timebox is 30 days, and its access
  token lifetime is 15 minutes. This clean-target proof does not replace the
  still-required production-shaped `0019` to `0024` reconciliation rehearsal.

Phase 0 must now deliver:

- Configuration and exact-head success of authenticated repository-byte CI
  through `OPS_HUB_QUOTE_TOOL_READ_TOKEN`.
- Authenticated Quote Tool runtime version health and live deploy-skew proof.
- RLS/authorization checklists and impersonated-role tests are defined for
  every field-facing Hub table and endpoint.
- A production-shaped staging migration rehearsal, hosted persona proof,
  idempotency, DLQ, kill-switch, and fail-closed activation gates. Phone
  provider configuration, recovery, reassignment, and password/session
  revocation are deliberately deferred under Decision 25.

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
