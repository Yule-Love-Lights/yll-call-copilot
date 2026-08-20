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
- Naldo does not perform pull-request state or merge clicks. Merge
  authorization must be a new message that explicitly says `merge` and names
  `yll-call-copilot` plus the pull-request number after the assistant shows the
  current head SHA and actual-diff summary. Bare `go`, plan approval, review
  approval, standing approval, or bulk approval is not merge authorization.
- Authorization applies only to the summarized head SHA. Any new commit,
  rebase, conflict resolution, or changed diff invalidates it. Repeat the
  applicable reviews and checks, show the new SHA and diff summary, and obtain
  new merge authorization.
- For that exact SHA, both Hub CI jobs, `Typecheck, lint, test, build, and local
  contract/schema pin` and `Supabase RLS and role impersonation`, must exist
  and conclude `SUCCESS`. Pending, failed, cancelled, skipped, neutral, or
  missing is a hard stop unless Naldo gives a new PR-specific exception after
  the assistant discloses the missing hosted evidence.
- After authorization, the assistant marks a draft ready and uses a merge
  commit. Never use squash, rebase, auto-merge, or an admin bypass unless the
  same SHA-bound authorization explicitly names that method. If GitHub blocks
  Ready or Merge, report the exact blocker and stop rather than asking Naldo
  to click it or bypassing a safeguard.
- After merge, wait for the production deployment and verify the affected
  production flow in a browser. For a documentation-only change, verify that
  the production deployment itself completes successfully. Do not report an
  unverified or failed deployment as complete.
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
