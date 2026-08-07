# Operations Hub final-review pack

Status: **review-only; no implementation is authorized by this branch**  
Prepared: 2026-08-06  
Hub branch: `codex/operations-hub-final-review`

This branch reconciles the Codex Hub specification with Claude's labor, pay,
and Quote Tool plan. It is the branch Claude and Naldo should review before the
build begins.

## Read in this order

1. `DECISIONS.md` — owner rulings and binding legal/display constraints.
2. `MASTER-PLAN.md` — one system plan across both repositories.
3. `OPERATIONS-HUB-SPEC.md` — normative employee and administrator behavior in
   the Hub.
4. `CONTRACT-V1.3-PROPOSAL.md` — proposed additions to the Quote Tool's
   canonical integration contract. This file is not itself canonical.
5. `FINAL-REVIEW-FINDINGS.md` — persona and cross-repository failure review.
6. `FEATURE-BACKLOG.md` — committed scope, launch blockers, and later ideas.
7. `SOURCE-PINS.md` — the exact source revisions reconciled here.
8. `CLAUDE-FINAL-REVIEW-HANDOFF.md` — the review prompt and approval procedure.

## Authority order

1. Naldo's dated rulings in `DECISIONS.md`.
2. The merged canonical contract in
   `yll-quote-tool/docs/context/OPERATIONS_HUB_CONTRACT.md` for cross-repository
   schemas, commands, events, time, pay, and Quote Tool facts.
3. `MASTER-PLAN.md` for the shared product and delivery model.
4. `OPERATIONS-HUB-SPEC.md` for Hub behavior.

If two documents conflict, work stops at the affected boundary until the
higher-authority document is corrected. No implementation may guess at wages,
privacy, surveillance, permissions, or source-of-truth ownership.

## Build gate

The build may start only after all of the following are true:

- Claude reviews this pack and incorporates every accepted contract amendment
  into the Quote Tool's canonical contract by PR.
- Naldo adds an approval line to `MASTER-PLAN.md` section 16.
- The canonical Quote Tool contract merges to Quote Tool `master` first.
- A byte-identical contract mirror and the shared JSON Schema artifact are then
  added to this Hub branch from that merged commit.
- Both repositories validate the same contract version and schema; the
  cross-repository byte comparison and deploy-version smoke pass.
- RLS/authorization checklists and impersonated-role tests are defined for
  every field-facing Hub table and endpoint.
- Required CI checks are green, the PR is current with its base, and a human
  performs the merge.

The existing planning PRs remain historical sources. They should not be merged
in place because their overlapping files and stale base create avoidable
conflicts.
