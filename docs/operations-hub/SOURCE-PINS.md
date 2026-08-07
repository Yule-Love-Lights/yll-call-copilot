# Source revisions reconciled by this review

Prepared: 2026-08-07

| Source | Branch / PR | Pinned head | Use |
|---|---|---|---|
| Codex Hub plan | `agent/operations-hub-plan`, PR #35 | `aaadea863f48cc7b7545ab0dc8d8cb872697c95f` | Hub behavior, SimpleCrew replacement, field workflows |
| Claude combined plan | `claude/operations-hub-plan`, PR #36 | `cdc1cb2fbe7356bab503f3af4a3f4d2682033882` | Decisions, shared master plan, backlog, contract mirror |
| Quote Tool canonical contract | `claude/copilot-labor-tracking-a14bf3`, PR #701 | head `ada0d732c354dc9b869cf77efc8af4161d14f649`; merge `72c2eb89b0533221e0966cbc9df25f39f5f8e7e9` | Accepted canonical time/pay/integration contract v1.3.0-draft |

## Known source condition

- PRs #35 and #36 are closed as superseded and remain historical source pins.
- The historical v1.2.0-draft mirror in PR #36 was not byte-identical because
  it contained an extra header/prefix. The final-review branch now carries the
  exact merged canonical bytes with no Hub wrapper.
- PR #36's `MASTER-PLAN.md` calls the contract v1.0.0-draft while its contract
  file is v1.2.0-draft. This pack removes that stale version reference.
- `CONTRACT-V1.3-PROPOSAL.md` is historical. Accepted P1-P15 language is
  authoritative only in the merged canonical contract and its exact Hub mirror.

## Final contract pins

- Quote Tool PR #701 merge commit:
  `72c2eb89b0533221e0966cbc9df25f39f5f8e7e9`
- Exact Quote Tool `master` source commit used for the mirror:
  `c65f73e1b8e0b061895d6d18bf28fa24ee6a2363`
- Canonical contract SHA-256:
  `9c929965e963bf21fe021877fcaf03d3333005f5e3ae73eff4eccbd642e75235`
- Hub mirror SHA-256:
  `9c929965e963bf21fe021877fcaf03d3333005f5e3ae73eff4eccbd642e75235`
- Hub mirror commit:
  `1e4ade9bd3bfbe760fba574a221bf301ec01ed41`
- Shared JSON Schema SHA-256: `PENDING` — the canonical Phase 0 artifact is not
  yet published in the Quote Tool repository.
