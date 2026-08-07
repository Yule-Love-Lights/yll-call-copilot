# Claude final-review handoff

Copy the prompt below into the Claude session that owns Quote Tool PR #701.

---

You are performing the final cross-repository review before the Yule Love
Lights Operations Hub build begins.

In `Yule-Love-Lights/yll-call-copilot`, open branch
`codex/operations-hub-final-review` and read the entire
`docs/operations-hub/` folder in this exact order:

1. `README.md`
2. `SOURCE-PINS.md`
3. `DECISIONS.md`
4. `MASTER-PLAN.md`
5. `OPERATIONS-HUB-SPEC.md`
6. `CONTRACT-V1.3-PROPOSAL.md`
7. `FINAL-REVIEW-FINDINGS.md`
8. `FEATURE-BACKLOG.md`

Review from five perspectives: advertising employee, installer, office
employee, Naldo/Jason owner-admin, and the boundary between the Quote Tool and
Operations Hub. Specifically test identity, multi-department context, personal
statistics, canonical time, travel, money/pay wording, advertising piece rate
and floor true-up, placement acceptance/reversal, sign inventory, job views and
completion, offline retries, Telegram, four digests, deactivation/final pay,
privacy/RLS, and contract/version failure handling.

The Hub documents may define Hub behavior, but they may not create a second
canonical time/pay/job system. The Quote Tool remains the sole owner of all
canonical time, pay calculations, payroll export, job facts, shared labor
migrations, `/api/ops/v1`, and the canonical contract.

Compare `CONTRACT-V1.3-PROPOSAL.md` with the current canonical file on Quote
Tool PR #701. For each proposal section P1-P16, mark **accept**, **accept with
replacement language**, or **reject with reason**. Do not silently edit the Hub
mirror. Apply every accepted contract change to the canonical Quote Tool file
through PR #701 (or a clearly linked successor PR) and bump/version its shared
schema accordingly.

Return:

1. A numbered list of any remaining contradiction or implementation blocker,
   naming the file/section and exact replacement language.
2. The canonical contract version you propose to merge.
3. The canonical file path, shared-schema path, and commit SHA after your update.
4. Confirmation that no Hub document asks the Hub to calculate pay or own
   canonical time.
5. One of these exact verdicts:
   - `Claude approves MASTER-PLAN 1.3-review-1 subject only to the recorded open decisions.`
   - `Claude does not approve yet:` followed by the numbered blockers.

Do not begin implementation and do not merge anything. After Claude approves,
Naldo adds his approval line. The Quote Tool canonical contract/schema merges
first by a human. Codex then copies the exact canonical bytes to the Hub branch,
runs cross-repo verification, and only then may Phase 0 implementation start.

---
