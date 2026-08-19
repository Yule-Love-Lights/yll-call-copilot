# Source revisions reconciled by this review

Prepared: 2026-08-07

Current contract pin verified: 2026-08-15

Current Hub implementation baseline verified: 2026-08-18

| Source | Branch / PR | Pinned head | Use |
|---|---|---|---|
| Codex Hub plan | `agent/operations-hub-plan`, PR #35 | `aaadea863f48cc7b7545ab0dc8d8cb872697c95f` | Hub behavior, SimpleCrew replacement, field workflows |
| Claude combined plan | `claude/operations-hub-plan`, PR #36 | `cdc1cb2fbe7356bab503f3af4a3f4d2682033882` | Decisions, shared master plan, backlog, contract mirror |
| Quote Tool canonical contract baseline | `claude/copilot-labor-tracking-a14bf3`, PR #701 | head `ada0d732c354dc9b869cf77efc8af4161d14f649`; merge `72c2eb89b0533221e0966cbc9df25f39f5f8e7e9` | Accepted canonical time/pay/integration contract v1.3.0-draft baseline |
| Quote Tool self-contained canonical contract | `naldo/ops-contract-v130-clarifications`, PR #716 | head `d2cf098658a595da1bd7b5b35ae553605fcbd1a0`; merge `5d56ebb62e23b2fe592cdc1912359b1ddf137270` | Canonical v1.3.0-draft consumed by the Operations Hub |
| Quote Tool Flow H canonical update | Quote Tool canonical history | `0a69fc0efc4998b59136057671e5705d8e5583f6` | Current canonical v1.4.0-draft, including Flow H commitment-verification events |
| Hub Flow H mirror | `naldo/217-flow-h-mirror`, PR #44 | head `277db428c880adf5350ed01b0d7918241587f576`; merge `0756b611c1e3bd7d6d3eeb4318b8677412ae0ad7` | Current byte-identical Hub mirror and contract pin |
| Hub immutable identity foundation | `codex/operations-hub-identity-foundation`, PR #50 | head `72487ae216c2d24b0870ed44852a668dc31596e6`; merge `44989e1ac1c7830ffdcd4d1e1f623db692547e9e` | Stable employee IDs, versioned Auth links, memberships, identity audit, and guarded compatibility projection |
| Hub recording sync backlog cap | `naldo/recording-sync-backlog-cap`, PR #51 | head `0724b31242d39caac1e5d53847af14e36b4d0fed`; merge `f2c9bd0761365a275f4793cd4f70dcf9c75cee26` | Merged Hub implementation baseline before the Phase 0 completion branch |

## Known source condition

- PRs #35 and #36 are closed as superseded and remain historical source pins.
- The historical v1.2.0-draft mirror in PR #36 was not byte-identical because
  it contained an extra header/prefix. The final-review branch now carries the
  exact merged canonical bytes with no Hub wrapper.
- PR #36's `MASTER-PLAN.md` calls the contract v1.0.0-draft while its contract
  file is v1.2.0-draft. This pack removes that stale version reference.
- `CONTRACT-V1.3-PROPOSAL.md` is historical. Accepted P1-P15 language is
  authoritative only in the merged canonical contract and its exact Hub mirror.

## Historical v1.3 baseline pins

- Quote Tool PR #701 baseline merge commit:
  `72c2eb89b0533221e0966cbc9df25f39f5f8e7e9`
- Self-contained canonical merge on Quote Tool `master`: PR #716, merge commit
  `5d56ebb62e23b2fe592cdc1912359b1ddf137270` (source head
  `d2cf098658a595da1bd7b5b35ae553605fcbd1a0`).
- Historical v1.3 canonical and Hub mirror SHA-256:
  `2fc10d33bf592b79d38741e8f40bdc1abcf52c2233d3be89521807211bbafa4a`
- Historical v1.3 canonical and Hub mirror byte length: `41336`
- Paired Hub branch: `codex/operations-hub-final-review`; its PR reports the
  exact commit that carries these bytes.
- Shared JSON Schema SHA-256: `PENDING` — the canonical Phase 0 artifact is not
  yet published in the Quote Tool repository.

## Current contract pin

- Contract version: `v1.4.0-draft`
- Quote Tool canonical commit:
  `0a69fc0efc4998b59136057671e5705d8e5583f6`
- Hub mirror merge: PR #44 at
  `0756b611c1e3bd7d6d3eeb4318b8677412ae0ad7`
- Canonical and Hub mirror SHA-256:
  `70ec41d325d7fb6ad907f0979b2389fa2cb6effb35e10bfd228c822cd42bfee4`
- Canonical and Hub mirror byte length: `47692`
- Machine-readable authority: `docs/operations-hub/contract-pin.json`
