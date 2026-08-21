# Operations Hub feature backlog

Status values: `COMMITTED` is already required by decisions/spec;
`PARTIALLY-RULED` has binding behavior plus a narrower remaining decision;
`BLOCKED-DECISION` needs a ruling before its feature ships; `LATER` is not V1
scope; `DEFERRED` is an approved future target that requires a later activation
decision. This file does not authorize implementation beyond the approved
master plan.

## Current, committed, and deferred plan

| Feature | Status | Owner |
|---|---|---|
| Invite-only email/password login | COMMITTED | Hub |
| Phone + OTP activation, recovery, reassignment, and password-identity revocation | DEFERRED | Hub |
| Versioned Hub/Quote employee identity link | COMMITTED | Hub / Quote boundary |
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
| Four digest types; admins receive all | COMMITTED | Both; Hub composition |
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
| Door hangers | PARTIALLY-RULED | Pay is OFF; capture unit and residential privacy/visibility remain open |
| Installer completion media | PARTIALLY-RULED | Media is optional and prompts stop after three attempts; camera/gallery provenance, GPS, and installed trigger remain open |
| Office qualified-call and seller credit | BLOCKED-DECISION | Formula and correction rights |
| Digests | PARTIALLY-RULED | Daily 08:00 America/New_York and Naldo/Jason on all four are ruled; department-recipient selection and escalation remain open |
| Deactivated employee access | BLOCKED-DECISION | Self-service duration |
| Payroll output | PARTIALLY-RULED | Generic columns and pay-line types are ruled; canonical subtotal-row fields, vendor mapping/order, and OT/blended-rate treatment remain open |
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
