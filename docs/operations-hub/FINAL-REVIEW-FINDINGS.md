# Final adversarial review findings

Date: 2026-08-06  
Review lenses: Advertising employee, Installer, Office employee, Owner/admin,
cross-repository/time/pay, inventory, statistics, Telegram, offline/reliability,
privacy/security, and release topology.

## Executive finding

The product direction is coherent, and the merged v1.3.0-draft canonical
contract now incorporates the P1-P15 boundary amendments and Naldo's four P16
rulings. Phase 0 may begin. The remaining decisions below block only their
affected features. One post-merge contract defect remains: P16.10 requires an
employee subtotal row but supplies no `subtotal` `line_type` or field semantics,
so payroll CSV implementation must wait for a canonical amendment.

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

- Door-hanger capture unit and residential visibility. Pay is ruled OFF.
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
- Camera/gallery provenance, GPS behavior, installed trigger, and departure
  behavior. Media is optional and prompts stop after three attempts.
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
- Department-recipient selection and digest escalation. The daily 08:00
  America/New_York schedule and Naldo/Jason on all four are ruled.
- Deactivated employee self-service access duration.
- CSV subtotal-row semantics, vendor mapping/order, OT/blended-rate treatment,
  and payroll review procedure. Generic columns and pay-line types are ruled.

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

The release sequence has two merge gates:

1. **Completed:** Quote Tool PR #701 merged the canonical contract.
2. **Completed on this branch:** Codex copied and byte-verified the exact
   contract. The Hub planning PR still requires a human merge; shared schemas
   remain a Phase 0 deliverable owned canonically by the Quote Tool.

PR #35 and PR #36 are closed as superseded and remain historical. No
implementation branch may fork from their conflicted combination.
