# Final adversarial review findings

Date: 2026-08-06  
Review lenses: Advertising employee, Installer, Office employee, Owner/admin,
cross-repository/time/pay, inventory, statistics, Telegram, offline/reliability,
privacy/security, and release topology.

## Executive finding

The product direction is coherent, but v1.2.0-draft is not yet safe to build
against. It names the major flows but leaves several boundaries too implicit
for two assistants to implement independently. The amended SPEC resolves Hub
behavior; `CONTRACT-V1.3-PROPOSAL.md` identifies the canonical additions Claude
must accept or revise before Phase 0 completes.

## Cross-repository P0 findings

| # | Gap / likely failure | Resolution in this pack |
|---|---|---|
| 1 | Hub mirror is not byte-identical and the master names a stale contract version. Deploys could claim compatibility while implementing different text. | Canonical merges first; exact mirror, shared schema, byte check, and deploy-version smoke are build gates. |
| 2 | Idempotency does not fully cover the same action arriving from PWA and Telegram or after an offline timeout. | Separate transport key and semantic operation; queryable command state and duplicate-of result. |
| 3 | Multi-department membership has no canonical switch operation, so time could be routed to the wrong department. | One active department per shift, versioned switch, no retroactive silent reassignment. |
| 4 | “Uploaded” or “accepted” placement could be interpreted differently by Hub, inventory, statistics, and pay. | Explicit placement lifecycle, stable accepted/reversed events, Quote acknowledgment, reconciliation, and week-close blockers. |
| 5 | Placement Run time and paid day time could diverge or be double-counted. | Start orchestration, run/clock remain distinct, X ends run only, partial-failure UI, clock-out/open-run review. |
| 6 | Sign inventory arithmetic could become the pay count or a wage deduction. | Append-only physical ledger; pay uses acknowledged accepted placement events; variance never deducts wages. |
| 7 | “Travel = everything left over” can hide missed taps and inflate/shift job economics. | Explicit travel operations or visible unclassified residual; Quote Tool remains canonical. |
| 8 | Offline completion could say complete before photos or canonical state exist. | Durable draft/media manifest/checksum plus canonical acknowledgment; separate field and office-review states. |
| 9 | Admin-seeded Quote identities and later OTP identities can duplicate people. | Owner-only versioned identity linking, uniqueness checks, and blocking review queue. |
| 10 | Deactivating a worker can strand time, quality windows, inventory, or final pay. | Deactivation-readiness API and restricted retained records. |
| 11 | Four digests combine data from both repos without a facts/version contract. | Typed digest facts, source-through/version metadata, persisted delivery state, and same privacy/pay rules. |
| 12 | Raw CSV can silently omit blockers or export provisional values. | Quote-owned readiness/lock/export endpoints; no provisional rows; later adjustments only. |

## Advertising employee review

### What now works

- One clear start action and automatic Camera Mode on reopen.
- A new shutter is available after local persistence instead of upload.
- The X has one meaning: End Placement Run. Clock Out is a separate explicit
  choice, preventing accidental loss of paid hours.
- Accuracy is honest: 1–5 m is a target, not a promise; weak/no GPS has visible
  review state.
- The worker can distinguish device-safe, waiting, under-review, accepted, and
  rejected photos.
- Personal rate distinguishes run hours from paid-day hours.

### Remaining decisions

- Door-hanger unit, pay, and residential visibility.
- Rejection/reversal codes, response path, and expected reviewer turnaround.
- Whether workers may see coworker live location; protective default is no.
- Maximum offline queue/storage policy and low-storage cutoff.

### Future improvements

- Safe parked-only route planning with hotspot/avoid priority.
- Revisit/removal verification if YLL later retrieves signs.
- Campaign supply forecast based on placements, variance, and historical demand.
- Optional accessibility modes: large shutter, haptics, voice confirmation, and
  glove-friendly controls.

## Installer review

### What now works

- Exact job information unlocks only after accepted clock-in, enforced by API.
- Manual Arrived/Departed remains understandable and pay-authoritative.
- GPS suggestion cannot silently create or change pay time.
- Budgeted elapsed time and crew hours are separate, preventing misleading
  performance comparisons when crew size changes.
- Offline completion cannot disappear or falsely finish billing.

### Remaining decisions

- Travel classification and missed-tap thresholds.
- Exact completion photo rule and departure behavior.
- Meal/break and overtime treatment validated by payroll/counsel.
- Weather/no-access/material stoppage policies.

### Future improvements

- Load-out checklist and shortage alerts tied to the Quote design/load list.
- Crew handoff, safety acknowledgement, vehicle/tool assignment, and job hazard
  notes.
- Offline navigation packet with explicit expiry and revoke support.
- Customer-ready arrival window updates driven only from canonical schedule.

## Office employee review

### What now works

- Existing Call Copilot features are preserved and routed as the Office home.
- Time capture remains separate from calls while identity is shared.
- Personal statistics disclose formula, period, exclusions, and freshness.
- Seller attribution uses immutable identity instead of names.

### Remaining decisions

- Exact qualified-call formula and which outcomes enter leaderboards.
- Who may correct seller credit and what audit/notification is required.
- Break configuration and office scheduling rules.

### Future improvements

- A single “needs office action” queue for install review, customer follow-up,
  missed calls, and Quote Tool exceptions.
- Workload/callback forecasting and coaching prompts based on current campaign
  and installation demand.
- Accessible personal coaching view that never turns provisional or incomplete
  data into a punitive ranking.

## Owner/admin review

### What now works

- One exception model connects command, identity, time, placement, inventory,
  completion, and export blockers.
- Only Naldo/Jason are provisioned in V1; “Manager” does not accidentally gain
  sensitive power.
- Corrections are append-only; payroll periods are locked and later changes
  become adjustments.
- Four department digests have explicit inputs and delivery state.

### Remaining decisions

- Week-close/placement reviewer permissions and service-level expectation.
- Digest schedule and any recipients beyond Naldo/Jason.
- Deactivated employee self-service access duration.
- CSV mapping and payroll review procedure.

### Future improvements

- A morning exception triage screen ordered by payroll/customer/safety risk.
- Contract/version dashboard, DLQ replay console, and reconciliation health.
- Audit exports and seasonal retrospective comparing hotspots, inventory,
  placement rate, calls, installs, budgeted hours, and outcomes without exposing
  personal pay publicly.

## Security/privacy review

- “Employees can see the team map” must not become default access to exact
  coworker trails. Default is self plus owner/admin, with operational map layers
  separated from personal route history.
- Door-hanger locations are residential and receive the strictest map default.
- GPS collection must be purpose-limited: visible placement capture and approved
  installer route evidence during a paid day, paused on break.
- RLS and API authorization require impersonated-role tests, including inactive,
  wrong-department, stale-membership, and unlinked identities.
- Local PWA media and offline packets require expiry/cleanup and no secrets in
  logs, notifications, URLs, or screenshots.

## Release review

The safest sequence is two merge gates:

1. Claude updates and merges the canonical Quote Tool contract and schema.
2. Codex copies those exact bytes into this Hub branch, verifies both repos,
   then the Hub planning PR may merge.

PR #35 and PR #36 should remain historical and later be closed as superseded;
they should not be merged together. No implementation branch should fork from
their conflicted combination.
