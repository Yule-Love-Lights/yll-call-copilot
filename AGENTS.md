# Operations Hub repository guardrails

These rules apply to the entire repository.

## Source-of-truth boundary

- Read `docs/operations-hub/README.md` before Operations Hub work.
- `docs/operations-hub/INTEGRATION-CONTRACT.md` is a byte-identical mirror.
  Never hand-edit, reformat, wrap, or regenerate it in this repository.
- Cross-repository contract changes originate in
  `Yule-Love-Lights/yll-quote-tool`, merge there first, and are then copied here
  byte-for-byte with `npm run verify:ops-contract:cross-repo`.
- Quote Tool owns canonical time, breaks, job segments, travel, compensation,
  payroll, shared labor migrations, `/api/ops/v1`, and Quote Tool job facts.
- This repository owns Hub UI/auth policy, campaigns, Placement Runs,
  placements, Hub capture media, hotspots/avoid zones, sign inventory, and
  Hub-owned call/coaching facts.
- Do not add a second time ledger, pay calculator, payroll export, Telegram
  webhook, or shared-labor migration here.

## Release safety

- Codex uses `codex/` branches, Claude uses `claude/` branches, and humans use
  the agreed contributor prefix.
- Naldo does not perform pull-request state or merge clicks. After Naldo
  explicitly approves a named pull request, the assistant must fetch and
  verify the current branch, run the required checks, mark the pull request
  ready if needed, and complete the merge using the repository's approved
  merge method. Never merge a pull request that Naldo has not specifically
  approved, and never bypass a failed or pending required check, a stale
  branch, branch protection, or an unresolved blocking review.
- PR #37 is the only reconciled planning source; PRs #35 and #36 are historical
  and closed as superseded.
- Phase 0 safety/foundation work may proceed on separately reviewed branches.
  Hub Tracks B/C must not merge until PR #37 is human-merged and the shared
  schema/version/RLS gates are complete. Quote Tool Track A is governed in the
  Quote Tool repository and does not depend on Hub OTP.
- Manager capabilities may be designed and tested, but only Naldo and Jason are
  provisioned as Owner/Admin in V1.
- Never display performance pay as earned before the canonical seven-day
  quality window clears.
- A changed contract pin, mirror, schema, authorization boundary, or money/time
  behavior requires focused tests and a human review.
- Do not provision Advertising or Installer accounts until
  `docs/operations-hub/PHASE-0-CHECKLIST.md` authorization and RLS gates pass.

## Required checks

- `npm run verify:ops-contract`
- `npx tsc --noEmit`
- `npm run lint`
- `npm test`
- `npm run build` for release-facing changes

When a local Quote Tool checkout is available, also run:

```sh
OPS_HUB_CANONICAL_CONTRACT_PATH=/absolute/path/to/yll-quote-tool/docs/context/OPERATIONS_HUB_CONTRACT.md \
  npm run verify:ops-contract:cross-repo
```
