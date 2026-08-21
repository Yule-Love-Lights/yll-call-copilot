# Source revisions reconciled by this review

Prepared: 2026-08-07; last reconciled: 2026-08-21

Current contract/schema pin verified: 2026-08-20

Hub implementation base audited through PR #61: 2026-08-21 at
`master@ba3ecc7fa0d6248353aa75fb79a75d549a2288ba`

| Source | Branch / PR | Pinned head | Use |
|---|---|---|---|
| Codex Hub plan | `agent/operations-hub-plan`, PR #35 | `aaadea863f48cc7b7545ab0dc8d8cb872697c95f` | Hub behavior, SimpleCrew replacement, field workflows |
| Claude combined plan | `claude/operations-hub-plan`, PR #36 | `cdc1cb2fbe7356bab503f3af4a3f4d2682033882` | Decisions, shared master plan, backlog, contract mirror |
| Quote Tool canonical contract baseline | `claude/copilot-labor-tracking-a14bf3`, PR #701 | head `ada0d732c354dc9b869cf77efc8af4161d14f649`; merge `72c2eb89b0533221e0966cbc9df25f39f5f8e7e9` | Accepted canonical time/pay/integration contract v1.3.0-draft baseline |
| Quote Tool self-contained canonical contract | `naldo/ops-contract-v130-clarifications`, PR #716 | head `d2cf098658a595da1bd7b5b35ae553605fcbd1a0`; merge `5d56ebb62e23b2fe592cdc1912359b1ddf137270` | Canonical v1.3.0-draft consumed by the Operations Hub |
| Quote Tool Flow H canonical update | Quote Tool canonical history | `0a69fc0efc4998b59136057671e5705d8e5583f6` | Historical pre-schema v1.4.0-draft, including Flow H commitment-verification events |
| Quote Tool contract/schema publication | `codex/ops-contract-schema-v1-4`, PR #803 | head `0cf17a4ab4accd4187bd631ebae0eac3abbbd7e3`; merge `c60bce4927a7fc47a8d6ee1d14a6eb88257755aa` | Current canonical v1.4.0-draft contract plus schema v1.0.0-draft manifest, OpenAPI, and JSON Schema |
| Historical Hub Flow H mirror | `naldo/217-flow-h-mirror`, PR #44 | head `277db428c880adf5350ed01b0d7918241587f576`; merge `0756b611c1e3bd7d6d3eeb4318b8677412ae0ad7` | Historical byte-identical Hub mirror and contract pin, superseded by PR #53 |
| Hub immutable identity foundation | `codex/operations-hub-identity-foundation`, PR #50 | head `72487ae216c2d24b0870ed44852a668dc31596e6`; merge `44989e1ac1c7830ffdcd4d1e1f623db692547e9e` | Stable employee IDs, versioned Auth links, memberships, identity audit, and guarded compatibility projection |
| Hub recording sync backlog cap | `naldo/recording-sync-backlog-cap`, PR #51 | head `0724b31242d39caac1e5d53847af14e36b4d0fed`; merge `f2c9bd0761365a275f4793cd4f70dcf9c75cee26` | Merged Hub implementation baseline before the Phase 0 completion branch |
| Hub Phase 0 completion | `codex/operations-hub-phase-0-completion`, PR #52 | head `c4d5b52a835196a354077adf74d3aa5d1e86e083`; merge `0b33c23b456cacc70a85ea717bb5df9eb311beda` | Staging safeguards, commitment extraction, recording sync, and Phase 0 ledger corrections |
| Hub contract/schema publication mirror | `codex/operations-hub-contract-v1-4-schema-mirror`, PR #53 | head `131579aaf997ba4fccd05b58f27205fd13a775fb`; merge `9be8cde51f673db07123e6895a12d4d08a03562f` | Byte-identical current contract, manifest, OpenAPI, and JSON Schema mirror |
| Hub assistant merge rule | `naldo/assistant-managed-pr-merges`, PR #54 | head `1e1516d82f90048a9128a16b2dd01554c8105391`; merge `bad885dc85b5d2c255bad8567b21a83f6ab2d4ec` | Original assistant-managed merge-rule baseline, extended by this H0 update |
| Hub release-ledger reconciliation | `codex/ops-ledger-reconciliation`, PR #57 | head `9337fd36ba6950267b70cc841945404b3f37d1bd`; merge `fc7d8d2c1c3a5b643f3b885697a3b0649d98e570` | Interim login, staging, hosted-migration, and release-state truth reconciliation |
| Hub hosted-migration reconciliation | `codex/staging-migration-reconciliation`, PR #60 | head `4478357d08f7af2f2112b2bced723d66ccef88ec`; merge `51c9467f172fb03129c97d1fd06511ce14b309ca` | Fail-closed hosted migration, history-repair, and exact recording-release tooling; no hosted write performed |
| Hub Phase 0 persona coverage | `codex/phase0-persona-coverage`, PR #58 | head `08d3e199c75a2b4eab950422a3416f816ef08ebc`; merge `2574935f2710ca2ed08b2742e77463bea7ca758d` | Audited pre-H0 Hub base; test-only immutable ownership, membership, Owner/Admin, revoked-link, and default-deny coverage |
| Hub contract-skew gate | `codex/phase0-contract-skew-gate`, PR #61 | head `4cde5826a15ad8a9e2c64eec36d2dc6ff59966c4`; merge `ba3ecc7fa0d6248353aa75fb79a75d549a2288ba` | Trusted authenticated cross-repository byte gate, static compatibility helper, and approved four-mode planning reconciliation |

## Known source condition

- PRs #35 and #36 are closed as superseded and remain historical source pins.
- PR #56 is closed without merge and is superseded by merged PR #60. It is not
  current implementation or procedure authority.
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
- The historical v1.3 baseline did not publish the shared machine-readable
  schema. Quote Tool PR #803 supersedes that gap for v1.4.

## Current contract pin

- Contract version: `v1.4.0-draft`
- Quote Tool canonical commit:
  `c60bce4927a7fc47a8d6ee1d14a6eb88257755aa`
- Canonical and Hub mirror SHA-256:
  `d3551f65561863af42721d020b357888acc6c90eb0c8c586f7bc151305395e7f`
- Canonical and Hub mirror byte length: `56963`
- Schema version: `v1.0.0-draft`
- Canonical manifest SHA-256:
  `f55582fbbc7a99a5f1f1d06f9aa6897af96886ddcd94833a820e4cbd315956dd`
- Canonical OpenAPI SHA-256:
  `2b57dec5de60cfdae774897905988e0ce855c3b38211abebce48d39a6b8d9ae1`
- Canonical JSON Schema SHA-256:
  `dd78f02291718bdcbc68c68487885ff2ea69888801c641f4ca8a93436db2047a`
- Machine-readable authority: `docs/operations-hub/contract-pin.json`
