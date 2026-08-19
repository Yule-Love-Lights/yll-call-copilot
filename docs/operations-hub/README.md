# Operations Hub final-review pack

Status: **owner-approved; immutable identity foundation merged; staging activation in progress**
Updated: 2026-08-18
Merged Hub source: PRs #37 and #40 through #51 at
`master@f2c9bd0761365a275f4793cd4f70dcf9c75cee26`. The current contract mirror
remains the byte-identical PR #44 pin recorded in `SOURCE-PINS.md`.

This pack is the reconciled and approved source for the Operations Hub.
Quote Tool PR #701 established the original canonical baseline, PR #716 made it
self-contained, Naldo signed the master plan, and Hub PR #37 was human-merged.
The current byte-identical mirror is `v1.4.0-draft`, pinned to Quote commit
`0a69fc0efc4998b59136057671e5705d8e5583f6` and merged through Hub PR #44.

## Read in this order

1. `DECISIONS.md` — owner rulings and binding legal/display constraints.
2. `MASTER-PLAN.md` — one system plan across both repositories.
3. `OPERATIONS-HUB-SPEC.md` — normative employee and administrator behavior in
   the Hub.
4. `INTEGRATION-CONTRACT.md` — byte-identical mirror of the merged Quote Tool
   canonical contract.
5. `CONTRACT-V1.3-PROPOSAL.md` — historical proposal retained for audit; it
   is not authoritative.
6. `FINAL-REVIEW-FINDINGS.md` — persona and cross-repository failure review.
7. `FEATURE-BACKLOG.md` — committed scope, launch blockers, and later ideas.
8. `SOURCE-PINS.md` — the exact source revisions reconciled here.
9. `CLAUDE-FINAL-REVIEW-HANDOFF.md` — historical final-review prompt.
10. `PHASE-0-CHECKLIST.md` — live safety gates and the field-provisioning stop.
11. `PHASE-0-AUTHORIZATION-INVENTORY.md` — current Hub-local actor, route,
    machine-auth coverage, deployment requirements, and remaining release
    blocks.
12. `PHASE-0-RLS-RUNBOOK.md` — the API-only database boundary, CI proof,
    hosted preflight, safe rollout order, and remaining identity tests.
13. `LIVE-CALLING-ACTIVATION-BLOCKERS.md` — the positive customer-call kill
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
- The Hub contract mirror is byte-identical to the canonical file.
- Fail-closed production auth, centralized capabilities, API-only database RLS,
  and Office lead/call resource authorization merged through PR #46.
- Hub PR #50 merged the immutable employee, versioned Auth-link, department
  membership, identity-audit, and guarded compatibility-projection foundation.
  Its application, migration-order, pgTAP, build, and Vercel checks passed.

Phase 0 must now deliver:

- The shared JSON Schema/OpenAPI artifacts from their canonical Quote Tool
  owner, vendored byte-identically in the Hub.
- CI validation of contract/schema bytes and runtime version compatibility.
- RLS/authorization checklists and impersonated-role tests are defined for
  every field-facing Hub table and endpoint.
- Staging phone OTP, session-age enforcement, owner-only recovery, password and
  session revocation, idempotency, DLQ, kill-switch, and fail-closed activation
  gates. The identity link and Hub-local identity audit are merged.

Merged PR #50 adds only Hub-owned immutable employee,
auth-link, active-state, membership-version, and local identity-audit
scaffolding. It does not invent the unpublished cross-boundary event envelope,
enable phone OTP, or create field accounts. The approved later target is
Supabase Phone Auth with Turnstile, Twilio Verify delivery, owner-only recovery,
password-identity revocation at activation with Supabase-console owner
break-glass, and a 30-day maximum Hub session. Placement Runs will require an
online start, allow at most 12 hours under an authorized offline window, and
quarantine expired or revoked-device work for Naldo/Jason review without
automatic pay or inventory credit. Management is an owner/admin view and
digest, not a paid-work department.

Fail-closed OTP code and tests may proceed in a separate Vercel preview and
staging Supabase project. Real staging activation still requires hosted
provider configuration, disabled public signup, enforced CAPTCHA, reviewed SMS
rate limits, a short access-token lifetime, and test identities. Field
provisioning, paid workflow, and production phone auth remain blocked on the
Quote-owned capability and current-context surfaces, canonical shared
schema/OpenAPI artifacts, hosted identity-persona proof, recovery, and
password/session revocation. Naldo ruled the Advertising placement/photo
visibility boundary on 2026-08-18; implementation and hosted authorization
proof remain Track B work.

PRs #35 and #36 are closed as superseded. Merged PR #37 is the only Hub
planning source. Every implementation PR still requires current gates and a
human merge.
