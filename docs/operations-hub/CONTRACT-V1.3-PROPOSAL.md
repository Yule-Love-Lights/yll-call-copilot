# Proposed Operations Hub <-> Quote Tool contract amendments

Proposed target: `v1.3.0-draft`  
Status: **proposal only; not canonical and not an implementation contract**  
Canonical owner: Quote Tool assistant / Claude

Claude should accept, revise, or reject each section with replacement language,
then update the canonical file at
`yll-quote-tool/docs/context/OPERATIONS_HUB_CONTRACT.md` through its PR. After
that file merges, Codex will copy it byte-for-byte to
`yll-call-copilot/docs/operations-hub/INTEGRATION-CONTRACT.md` and both CIs will
validate the same JSON Schema artifact.

## P1. Version and deploy invariants

Add three distinct version values to every request/response and health surface:

- `contract_version` — semantic API/behavior contract;
- `schema_version` — shared envelope/event JSON Schema;
- `client_version` — deployed caller build.

Both repos SHALL expose supported ranges. Deployment SHALL fail when the two
applications disagree on contract/schema compatibility. CI SHALL compare the
canonical and Hub mirror bytes after canonical merge.

## P2. Canonical mutation envelope

Every consequential request SHOULD use this envelope (names may be adjusted to
match existing conventions without weakening semantics):

```json
{
  "command_id": "uuid",
  "idempotency_key": "stable-retry-key",
  "semantic_operation": "employee:date:operation:entity",
  "actor_employee_id": "hub-employee-id",
  "impersonating_actor_id": null,
  "source": "hub_pwa|telegram|office|admin|system",
  "contract_version": "1.3.0-draft",
  "schema_version": "1.0.0",
  "client_version": "build-id",
  "entity_version": 7,
  "device_occurred_at": "RFC3339",
  "device_timezone": "America/New_York",
  "client_sequence": 42,
  "effective_at_requested": "RFC3339",
  "offline_packet_id": null,
  "active_department_id": "uuid",
  "membership_version": 3,
  "gps_evidence": null,
  "reason": null,
  "evidence_refs": [],
  "correlation_id": "uuid"
}
```

Canonical response SHOULD include:

```json
{
  "command_id": "uuid",
  "canonical_operation_id": "uuid",
  "command_status": "accepted|accepted_with_review|pending|rejected|superseded",
  "received_at": "RFC3339",
  "effective_at": "RFC3339",
  "entity_version": 8,
  "review_flag": null,
  "error_code": null,
  "duplicate_of_command_id": null,
  "correlation_id": "uuid"
}
```

`idempotency_key` protects transport retries. `semantic_operation` protects the
same human action submitted through a second channel. A duplicate SHALL return
the original canonical result, not a second effect.

Add `GET /api/ops/v1/commands/{command_id}` so a timed-out/offline caller can
resolve final state after reopen.

Recommended additional error codes:

- `CONTRACT_VERSION_UNSUPPORTED`
- `SCHEMA_VERSION_UNSUPPORTED`
- `ENTITY_VERSION_CONFLICT`
- `IDENTITY_NOT_LINKED`
- `MEMBERSHIP_STALE`
- `ACTIVE_DEPARTMENT_REQUIRED`
- `CLOCK_REQUIRED`
- `OFFLINE_PACKET_EXPIRED`
- `OFFLINE_PACKET_SCOPE_DENIED`
- `EFFECTIVE_TIME_REVIEW_REQUIRED`
- `PLACEMENT_ACK_PENDING`
- `INVENTORY_RECONCILIATION_REQUIRED`
- `PAY_PERIOD_LOCKED`

## P3. Identity seeding and linking

Track A SHALL be allowed to start with admin-seeded Quote Tool `crew_members`
for Naldo/Jason and early employees while `hub_employee_id` is null. Quote Tool
SHALL NOT create or mutate a Hub employee.

Add an owner-only identity-link operation with optimistic versioning:

`POST /api/ops/v1/identity-links`

Required facts: Quote crew member, Hub employee, verified phone, optional
Telegram identity, actor, reason, effective time, prior link version.

Emit `IdentityLinked`, `IdentityLinkChanged`, and `IdentityUnlinked`. Duplicate
phone/Telegram/employee links SHALL hard-fail and enter an owner review queue.

## P4. Multi-membership and active department

- A Hub employee MAY have multiple active department memberships.
- A canonical paid shift SHALL have one `active_department_id` at a time.
- `ClockIn` SHALL require active department plus membership version.
- Add `POST /api/ops/v1/me/department-context/switch` with requested effective
  time and reason.
- A switch during an open break, job segment, or Placement Run SHALL follow an
  explicit owner-approved rule; default is reject/review, never silent split.
- Emit `DepartmentContextChanged` and preserve prior segment classification.

## P5. Offline/effective-time acceptance

Define a signed, scoped offline packet endpoint:

`POST /api/ops/v1/me/offline-packets`

The packet SHOULD identify employee, shift/day, allowed operations/entities,
issued/expires times, contract/schema versions, membership version, and nonce.

Define accepted maximum packet age, device-clock drift, GPS age/accuracy, and
sequence rules before offline gated actions launch. Missing/poor GPS SHOULD
create a review flag when the operation is otherwise allowed; it SHALL not erase
the command or allow the client to fabricate evidence.

The server SHALL persist device time, receipt time, requested effective time,
chosen effective time, and the policy/reviewer that chose it.

## P6. Time classification, travel, and corrections

Canonical time SHALL remain one non-overlapping paid-day envelope.

Add/confirm explicit semantic operations:

- `clock_in`, `break_start`, `break_end`, `arrive_job`, `depart_job`,
  `travel_start`, `travel_end`, `non_billable_start`, `non_billable_end`, and
  `clock_out`;
- department switch and placement-run linkage SHALL not independently create
  paid time.

Time outside job/break/non-billable SHALL be returned as `unclassified_seconds`
unless an explicit approved rule classifies it as travel. The Hub SHALL not
infer pay travel.

Add typed exceptions including open segment, open break, missed tap, overlap,
duplicate, device drift, poor/missing GPS, overnight/DST, active-context
mismatch, offline-packet issue, and correction request.

Add employee correction-request endpoints for day, break, segment,
classification, department, and effective time. Owner resolution SHALL append
before/after/reason/actor/effective version. Locked/exported periods SHALL use a
later adjustment row.

## P7. Job assignment and budget facts

The installer assignment/read API SHOULD include:

- `budgeted_elapsed_hours`
- `planned_crew_size`
- `budgeted_crew_hours`
- `job_lead_employee_id`
- `assigned_crew[]` with role
- design/load-list references and job notes
- gate state and source version

Pre-clock response SHALL omit exact address/contact/route/action tokens. Add an
audited emergency-override operation with requester, approver, reason, start,
expiry, and employee.

## P8. Completion state and offline draft

Replace a single ambiguous completion status with two dimensions:

- `field_work_state`: `not_started|in_progress|field_work_completed`
- `completion_review_state`:
  `not_submitted|completion_submitted_for_office_review|accepted|needs_changes`

The completion command SHOULD include `depart_behavior` so arrival/departure and
completion cannot leave an unintended open segment.

Keep materials fields pinned across PWA, Telegram, and office:
`materials_used[] { sku, qty, estimated_qty? }`, optional on-hand true-up,
`note?`, `photo_refs[]`, and raw text/audit reference.

Add an offline completion-draft handshake or upload session:

- create draft/session;
- upload media by checksum with manifest;
- query acknowledged objects;
- submit canonical completion only when required references are durable;
- retry returns the same completion result.

Emit separate `FieldWorkCompleted`, `CompletionReviewChanged`, and
`JobDeparted` events. None may financially complete a job.

## P9. Quality case and deactivation

Add employee-readable quality-case facts/endpoints containing job, state,
quality-window close, immutable evidence, reason code, responsibility scope,
employee response state/deadline, reviewer, and final event version.

No surface may call provisional performance pay earned before the seven-day
window clears.

Add owner-only deactivation readiness:

`GET /api/ops/v1/crew/{id}/deactivation-readiness`

Response SHOULD list open clocks, corrections, unclosed pay weeks, provisional
quality cases, payroll adjustments, unacknowledged placement events, inventory
allocations, DLQ commands, and identity links. Deactivation SHALL not delete
retained final-pay/audit records.

## P10. Advertising placement event contract

Quote Tool SHALL consume pay inputs only from acknowledged Hub events. Define:

- `PlacementAccepted`
- `PlacementReversed`
- optionally `PlacementAcceptanceCorrected`

Each event SHALL include event ID, placement ID/version, employee/identity-link
version, campaign and unit type, accepted/reversed effective time, capture and
receipt times, reviewer/reason, inventory event reference, and correlation ID.

Add a batch delivery/acknowledgment endpoint with per-event results. Hub SHALL
retain retry state. Quote Tool SHALL deduplicate by event ID and return the
existing result.

Add a reconciliation read that compares Hub accepted/reversed totals with Quote
Tool acknowledged totals by employee/campaign/week.

## P11. Advertising week and piece-rate inputs

Define week states such as:

`open -> submitted_for_reconciliation -> ready_to_close -> closed -> adjusted`

Add owner operations to submit, review blockers, close, and append adjustments.
Week Close SHALL fail while placement events, identity links, or inventory
reconciliation are unresolved.

`AdvertisingWeekClosed` SHOULD include:

- employee, week/timezone, version, closed/approved actor and time;
- accepted count, reversed count, net pay count, campaign/unit breakdown;
- issued, placed, returned, approved damage/loss, expected-back, actual-back,
  and variance;
- source event high-water marks and reconciliation status.

Quote Tool compensation config SHALL effective-date unit rate and floor rate.
Initial approved values are 250 cents per accepted placement and 1700 cents per
hour floor. Quote Tool SHALL calculate and return unit pay, floor comparison,
floor true-up, total, state, and blockers. Inventory variance SHALL never be a
wage deduction.

Door-hanger pay SHALL remain disabled/unconfigured until Naldo rules its pay
unit and privacy workflow.

## P12. Office metrics and seller attribution

Define canonical call/outcome event identity before cross-app office metrics are
combined. A qualified-call formula SHALL be versioned/effective-dated and every
stat read SHALL expose numerator, denominator, exclusions, source-through time,
and formula version.

Add/confirm `sold_by_employee_id` using immutable identity, plus events for
installed notification and review/referral enqueue. Provide an owner correction
request/decision flow; never reattribute by matching display names.

## P13. Four digest model

Define digest types:

- `office`
- `advertising`
- `install`
- `management`

Add a canonical facts endpoint or event bundle per type/period with source-
through time and version. Hub composes/delivers; Quote Tool owns time/pay/job
facts and Hub owns placement/inventory/call facts.

Persist digest record: ID, type, period, input versions, recipients, rendered
artifact checksum/reference, delivery states, retry counts, and correlation ID.
Admins Naldo/Jason receive all four. Pay wording and authorization SHALL match
live UI.

If Telegram relays the digest, define an idempotent relay operation and delivery
events. Existing two-second interim-reply SLA applies to user commands, while
scheduled digest delivery uses its own observable deadline/retry policy.

## P14. Payroll readiness and raw CSV

Add Quote Tool-owned operations:

- payroll-period readiness/blocker read;
- owner close/lock;
- raw CSV generation/download;
- post-export adjustment listing.

Blockers SHOULD include unapproved time, open clocks/breaks/segments, unresolved
quality state, placement acknowledgment mismatch, advertising-week mismatch,
identity issue, missing compensation config, and pending adjustment.

CSV SHALL contain no provisional values and SHOULD use one row per pay line with
stable IDs and types such as hourly base, installer performance earned,
advertising piece-rate, floor true-up, training bonus, referral bonus, and
manual adjustment. Exact payroll-vendor columns/order remain an owner/payroll
decision. QuickBooks is out of V1.

## P15. Observability and event delivery

- Every event SHALL have stable event ID, aggregate/entity version, occurred and
  effective times, contract/schema version, actor/source, and correlation ID.
- Outbox delivery SHALL be at-least-once; consumers SHALL be idempotent.
- Dead-letter metrics SHALL include depth, oldest age, operation type, and last
  error. Threshold breach SHALL alert through the existing Telegram bot.
- Reconciliation jobs SHALL detect missing/out-of-order placement, inventory,
  time, completion, identity, and digest events.
- A replay SHALL not duplicate time, completion, inventory, accepted placement,
  earnings, payroll, or notifications.

## P16. Owner decisions needed before finalizing v1.3

1. Offline packet lifetime, allowed drift, GPS age/accuracy, and permitted
   operations.
2. Department switch behavior during open run/job/break and approval rights.
3. Installer travel classification and missed-tap thresholds.
4. Placement rejection/reversal codes, reviewer SLA, and week-close roles.
5. Door-hanger unit/pay/privacy rules.
6. Completion photo requirements and exact installed-notification trigger.
7. Qualified-call formula and seller-credit correction policy.
8. Digest schedule/recipients/escalation.
9. Deactivated employee self-service duration.
10. Payroll CSV mapping/order and overtime/blended-rate treatment.

An unresolved item SHALL disable only its affected behavior. It SHALL not be
filled in by client assumptions.
