# Source revisions reconciled by this review

Prepared: 2026-08-07

| Source | Branch / PR | Pinned head | Use |
|---|---|---|---|
| Codex Hub plan | `agent/operations-hub-plan`, PR #35 | `aaadea863f48cc7b7545ab0dc8d8cb872697c95f` | Hub behavior, SimpleCrew replacement, field workflows |
| Claude combined plan | `claude/operations-hub-plan`, PR #36 | `cdc1cb2fbe7356bab503f3af4a3f4d2682033882` | Decisions, shared master plan, backlog, contract mirror |
| Quote Tool canonical contract baseline | `claude/copilot-labor-tracking-a14bf3`, PR #701 | head `ada0d732c354dc9b869cf77efc8af4161d14f649`; merge `72c2eb89b0533221e0966cbc9df25f39f5f8e7e9` | Accepted canonical time/pay/integration contract v1.3.0-draft baseline |
| Quote Tool self-contained canonical contract | `naldo/ops-contract-v130-clarifications`, PR #716 | head `d2cf098658a595da1bd7b5b35ae553605fcbd1a0`; merge `5d56ebb62e23b2fe592cdc1912359b1ddf137270` | Canonical v1.3.0-draft consumed by the Operations Hub |

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

- Quote Tool PR #701 baseline merge commit:
  `72c2eb89b0533221e0966cbc9df25f39f5f8e7e9`
- Self-contained canonical merge on Quote Tool `master`: PR #716, merge commit
  `5d56ebb62e23b2fe592cdc1912359b1ddf137270` (source head
  `d2cf098658a595da1bd7b5b35ae553605fcbd1a0`).
- Canonical and Hub mirror SHA-256:
  `2fc10d33bf592b79d38741e8f40bdc1abcf52c2233d3be89521807211bbafa4a`
- Canonical and Hub mirror byte length: `41336`
- Paired Hub branch: `codex/operations-hub-final-review`; its PR reports the
  exact commit that carries these bytes.
- Shared JSON Schema SHA-256: `PENDING` — the canonical Phase 0 artifact is not
  yet published in the Quote Tool repository.
