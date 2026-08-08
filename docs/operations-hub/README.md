# Operations Hub final-review pack

Status: **owner-approved; PR #37 human-merged; Phase 0 foundation in progress**
Prepared: 2026-08-07
Merged Hub source: PR #37 at
`master@f6cc06bcc9009a8d4357b0adcb31e16ae150d8cc`

This pack is the reconciled and approved source for the Operations Hub.
Quote Tool PR #701 established the canonical `v1.3.0-draft` baseline, PR #716
merged its self-contained form, Naldo signed the master plan, Hub PR #37 was
human-merged, and the byte-identical Hub mirror is now present.

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

Phase 0 must now deliver:

- The shared JSON Schema/OpenAPI artifacts from their canonical Quote Tool
  owner, vendored byte-identically in the Hub.
- CI validation of contract/schema bytes and runtime version compatibility.
- RLS/authorization checklists and impersonated-role tests are defined for
  every field-facing Hub table and endpoint.
- Identity-link, auth, audit, idempotency, DLQ, kill-switch, and fail-closed
  scaffolding.

PRs #35 and #36 are closed as superseded. Merged PR #37 is the only Hub
planning source. Every implementation PR still requires current gates and a
human merge.
