# Source revisions reconciled by this review

Prepared: 2026-08-06

| Source | Branch / PR | Pinned head | Use |
|---|---|---|---|
| Codex Hub plan | `agent/operations-hub-plan`, PR #35 | `aaadea863f48cc7b7545ab0dc8d8cb872697c95f` | Hub behavior, SimpleCrew replacement, field workflows |
| Claude combined plan | `claude/operations-hub-plan`, PR #36 | `cdc1cb2fbe7356bab503f3af4a3f4d2682033882` | Decisions, shared master plan, backlog, contract mirror |
| Quote Tool canonical proposal | `claude/copilot-labor-tracking-a14bf3`, PR #701 | `fc55cf94d86fa42e9c1a064567a31ac0e6f1aab6` | Canonical time/pay/integration contract v1.2.0-draft |

## Known source condition

- PR #36 was based on an older PR #35 revision and has add/add conflicts. It is
  a source to reconcile, not a branch to merge.
- The v1.2.0-draft Hub mirror in PR #36 is not byte-identical to the canonical
  Quote Tool file because it contains an extra header/prefix. The final mirror
  must be copied from the merged canonical file with no wrapper text.
- PR #36's `MASTER-PLAN.md` calls the contract v1.0.0-draft while its contract
  file is v1.2.0-draft. This pack removes that stale version reference.
- `CONTRACT-V1.3-PROPOSAL.md` is an amendment proposal. Its contents do not
  become authoritative until Claude applies the accepted language to the
  canonical Quote Tool file and that PR is reviewed and merged.

## Final pins still to record

After Claude's contract changes merge, record:

- Quote Tool canonical merge commit: `PENDING`
- Canonical contract SHA-256: `PENDING`
- Shared JSON Schema SHA-256: `PENDING`
- Hub mirror commit: `PENDING`
- Hub mirror SHA-256: `PENDING` (must equal canonical)
