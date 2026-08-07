# Operations Hub feature backlog

Status values: `COMMITTED` is already required by decisions/spec;
`BLOCKED-DECISION` needs a ruling before its feature ships; `LATER` is not V1
scope. This file does not authorize implementation beyond the approved master
plan.

## Contract-committed / V1 plan

| Feature | Status | Owner |
|---|---|---|
| Phone + OTP identity UI; admin-seeded Track A identity bridge | COMMITTED | Hub / Quote boundary |
| Multi-department memberships; one active context per paid shift | COMMITTED | Hub memberships, Quote time context |
| Manager tier designed/tested but unprovisioned | COMMITTED | Hub |
| Quote-owned canonical day clock, breaks, visits, travel, corrections | COMMITTED | Quote Tool |
| Manual pay-authoritative punches; GPS corroboration only | COMMITTED | Quote Tool + Hub evidence |
| Soft server-side clock gate | COMMITTED | Quote Tool policy, Hub UI |
| Placement Run auto-camera reopen and explicit End Run | COMMITTED | Hub |
| Durable rapid camera queue, GPS labeling, atomic Sign Number | COMMITTED | Hub |
| Placement acceptance/reversal acknowledgment and reconciliation | COMMITTED | Both |
| Hotspots and avoid zones | COMMITTED | Hub |
| Sign inventory weekly allocation and reconciliation | COMMITTED | Hub; Quote consumes pay count |
| $2.50 accepted-placement piece rate + $17/hr floor true-up | COMMITTED | Quote Tool only |
| Installer assignment, manual Arrived/Departed, completion draft | COMMITTED | Both |
| Pending-quality display law and seven-day window | COMMITTED | Quote Tool state; every surface |
| Four department digests; admins receive all | COMMITTED | Both; Hub composition |
| Telegram shared commands, two-stage reply, advertising deep link | COMMITTED | Quote Tool bot |
| Raw payroll CSV; QuickBooks deferred | COMMITTED | Quote Tool |
| Six-year wage record / 120-day raw route retention | COMMITTED | Each canonical owner |
| Shared schema, byte mirror, RLS checklist, DLQ alert, deploy smoke | COMMITTED | Both |

## Decisions required before affected feature ships

| Feature | Status | Needed ruling |
|---|---|---|
| Offline gated job actions | BLOCKED-DECISION | Packet age, drift, GPS, allowed operations |
| Department switch during open state | BLOCKED-DECISION | Reject, auto-split, or owner-review policy |
| Installer travel and missed taps | BLOCKED-DECISION | Classification and thresholds |
| Placement review/week close | BLOCKED-DECISION | Reason codes, SLA, approvers |
| Door hangers | BLOCKED-DECISION | Capture unit, pay, privacy |
| Installer completion media | BLOCKED-DECISION | Count, camera/gallery, GPS, installed trigger |
| Office qualified-call and seller credit | BLOCKED-DECISION | Formula and correction rights |
| Digests | BLOCKED-DECISION | Schedule, extra recipients, escalation |
| Deactivated employee access | BLOCKED-DECISION | Self-service duration |
| Payroll output | BLOCKED-DECISION | CSV mapping/order and OT/blended-rate treatment |
| Break/meal policy by department | BLOCKED-DECISION | Payroll/counsel-approved configuration |

## Later candidates

| Candidate | Status |
|---|---|
| QuickBooks payroll integration and guided payroll-day wizard | LATER |
| Calibrated GPS-promoted installer visits | LATER |
| Sign retrieval/removal workflow | LATER |
| Sign-to-call attribution (reserved Flow F) | LATER |
| Customer reschedule/arrival notifications | LATER |
| Vehicle/tool assignment and cost tracking | LATER |
| PTO/sick/holiday and off-season workflow | LATER |
| New-hire onboarding and training attestations | LATER |
| Inventory demand forecasting and purchase suggestions | LATER |
| Advanced hotspot performance and route optimization | LATER |
| Accessibility/parked-use camera controls | LATER |
| Seasonal operations retrospective and anomaly detection | LATER |
