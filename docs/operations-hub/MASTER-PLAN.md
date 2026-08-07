# Yule Love Lights Operations Hub — Reconciled Master Plan

Status: Reviewed master plan  
Date: 2026-08-06  
Target: `ops.yulelovelights.com`  
Hub repository: `Yule-Love-Lights/yll-call-copilot`  
Partner repository: `Yule-Love-Lights/yll-quote-tool`

## 1. Mission

Rename and expand YLL Call Copilot into the private Yule Love Lights Operations Hub: one installable PWA for office work, advertising placement, installer operations, management, and employee metrics. The Quote Tool continues to own customers, quotes, jobs, schedules, labor calculations, and pay.

The Hub must be faster than SimpleCrew in the field, honest about browser/GPS limits, safe offline, and incapable of producing a second payroll or job ledger.

## 2. Product principles

1. One fact has one authoritative system.
2. Camera work takes one launch tap during an active Placement Run whenever device permissions allow.
3. A photo is safe before the camera resets; upload never blocks the next placement.
4. Offline is a supported operating state, with visible local/server status.
5. GPS accuracy is uncertainty, never false precision.
6. Browser location may suggest a visit; manual controls remain available.
7. Pay-affecting writes are server-authorized, idempotent, append-audited, and reviewable.
8. Provisional performance pay is never called earned, made, owed, or paid.
9. Employee screens are department-specific. Only Naldo and Jason control identities, canonical time, or compensation settings.
10. Telegram and the PWA call the same services; neither creates shadow truth.

## 3. System-of-record boundary

### Quote Tool owns

- Customers, quotes, invoices, collections, jobs, job IDs, schedule, assignments, route order, capacity, and operational job status.
- Design geometry, production rates, Budgeted Hours, labor percentage/revenue, P4P eligibility, calculation, quality state, earning state, and payroll export.
- Labor worker records and canonical day/job time entries, breaks, travel partitions, approvals, export locks, and adjustments.
- Job completion-photo references and the Telegram bot for job/time/pay commands.
- All shared labor schema migrations and `/api/ops/v1` routes.

### Operations Hub owns

- Phone OTP authentication, app profile, department, app role, active state, sessions, and device/offline state.
- Existing office/call UI and Hub-only goals/preferences.
- Advertising campaigns, assignments, Placement Runs, placements, Sign Numbers, original/stamped photos, capture metadata, hotspots, avoid areas, maps, and metrics.
- Consented raw route evidence, device diagnostics, offline command envelopes, and read-model caches.
- Hub audit events for identity/role/advertising/integration actions.

### Mapping rule

One immutable `employee_id` maps uniquely to Hub auth UUID, Quote Tool `crew_member_id` when labor-tracked, phone number, and Telegram ID when paired. Runtime linkage never depends on a name. Invite, department change, deactivation, rehire, and repair are explicit state transitions. Partial provisioning is labeled and retried; it never creates an unseen duplicate.

The Hub may cache Quote Tool projections with source ID/version/time. It never edits cached labor truth locally or computes authoritative pay.

## 4. Roles

### Naldo and Jason — owner/admin

- See all operational data and owner-only configuration.
- Invite/deactivate users; assign one department and role.
- Jason is primary canonical-time approver; Naldo is owner/backup approver.
- Only they may add, split, reject, correct, approve, reopen, lock, or adjust canonical time.
- Only they manage P4P configuration, quality finalization, exports, and integration settings.
- An owner doing a tracked employee shift clocks in; ordinary owner administration does not create a time punch.

### Manager

- Must clock in/out and chooses the department being managed for that shift.
- Personal Clock In/Out stays above management queues.
- Sees full operational dashboards and exceptions.
- May comment and recommend; cannot mutate or approve canonical time, grant owner powers, change pay, or expose secrets.

### Office employee

- Office Home, day Clock In/Out, optional break, existing call tools, own hours/performance.
- No field modules outside assigned department.

### Advertising employee

- Assigned-campaign Home, one-tap Placement Run, camera, own/assigned campaign history, hotspots/avoid areas, approved metrics.
- Placement Run duration is productivity data, not payroll time.
- No payroll break controls for advertising work unless a later approved wage policy adds a separate day clock.

### Installer

- Day Clock In/Out, optional break, schedule summary, today's work, manual Arrived/Departed, completion, own hours/efficiency, compliant pay states, team/approved leaderboard.
- Foreground route evidence may suggest visits after Phase 5 calibration.

Each employee has one department at a time. A manager may choose a management context at clock-in; ordinary employees cannot switch departments or campaign type within a run.

## 5. Authentication and security foundation

- Invite-only phone number + one-time PIN; only Naldo/Jason activate users.
- OTPs are short-lived, one-use, rate-limited, and never logged.
- Protected requests re-check the linked employee is active; deactivation cannot rely only on a long-lived JWT expiring.
- Sensitive actions require recent authentication and server-side role checks.
- Hub-to-Quote calls use TLS, environment-specific scoped machine credentials, replay protection, rotation, and request limits. Service keys never enter the browser.
- Consequential writes and audit/outbox records commit together or remain recoverably pending.
- Production cron/webhook routes fail closed when secrets are absent. Existing public routes receive a security audit before launch.
- PWA caches only versioned static shell assets. Auth pages, APIs, employee data, addresses, routes, pay, and signed media are network-only/no-store. Logout and service-worker upgrade clear sensitive state.
- Independent kill switches cover advertising writes, Quote writes, Telegram writes, and route collection.

## 6. Advertising plan

### Campaigns

- Owners freely create Yard Sign or Door Hanger campaigns.
- Each campaign starts a new automatically increasing Sign Number sequence.
- Employees see only assigned campaigns.
- When multiple campaigns are assigned, Home shows one large Start button per campaign; one tap starts it and opens Camera Mode.

### Placement Run state

- A new run requires connectivity at launch. Once server-confirmed, it can continue and end offline using cached authorization and idempotent queued commands.
- Only one active run per employee is server-enforced.
- While active, PWA launch routes directly to Camera Mode. If the OS requires a permission gesture, one `Open Camera` tap is the fallback.
- The `X` ends immediately and returns Home. A short Undo restores an accidental end without a confirmation dialog.
- At local midnight, a forgotten run auto-reconciles to the last durably persisted shutter time, not upload/approval time. A zero-photo run becomes abandoned/review. The offline device queues the same result.
- Clocking out mid-run closes/reconciles the run and adds an end-of-day punch review note.
- Placement/hour uses full start-to-X duration for explicit ends and start-to-last-durable-photo for auto-closed runs. End reason is displayed.

### Camera

The screen contains campaign, duration/count, camera preview, large shutter, flash, switch-camera, current location accuracy, upload count/status, optional note access, and X.

On shutter:

1. Capture one live-camera image.
2. Record capture time, employee, campaign, run, coordinates, horizontal accuracy, GPS sample time, camera provenance, and device/idempotency ID.
3. Durably store original + metadata locally before resetting.
4. Immediately reopen live preview.
5. Upload while the PWA is active/online and resume on reopen.
6. Finalize atomically: validate original, create placement, allocate server number, create stamped derivative/thumbnail, and commit outbox/audit.
7. Stamp date/time, address, GPS accuracy, and `Sign Number` server-side; retain the original.
8. Display Pending, Uploading, Uploaded, Needs Attention, or Failed without blocking the next shutter.

The original is uploaded once. Orphan upload objects have a safe cleanup state and are not deleted while recoverable evidence remains queued.

Camera Roll images are not verified placements. A future owner import is labeled `Unverified import` and excluded from verified metrics by default. Blur is not a rejection reason; location is the essential proof.

### GPS

- `0–5 m`: excellent target.
- `>5–10 m`: good.
- `>10–20 m`: accepted with accuracy shown.
- `>20 m`: low-confidence review by default.
- No coordinates: not verified.

A missing fix may be attached only in a short same-camera grace window while the employee remains at the spot. Record the photo/GPS time delta. Another shutter, movement, context close, or expiry makes it unverified; never attach a later unrelated coordinate. Naldo/Jason resolve exceptions.

Store coordinates in SRID 4326 geospatial fields; use geography/GiST indexes and meter-based distances. Reverse-geocoding failure does not erase valid raw coordinates.

### Offline and numbering

- Pending data survives normal close/reopen absent OS eviction. Request persistent storage where supported and warn before low storage.
- Queue offers Retry, Retry All, and actionable failures. It cannot promise survival after uninstall, cleared site data, device loss, or OS eviction.
- Permanent Sign Numbers use atomic server-acceptance order. Offline cards say `Number pending`.
- Feed order uses capture time; numbers never change or get reused, including voids.
- Duplicate retries return the original result.
- Employee may Undo their latest placement for five minutes. It becomes a soft void, leaves audit/photo history, leaves a number gap, and disappears from active maps/metrics.
- No duplicate-location warning interrupts capture.

### Hotspots, avoid areas, and privacy

- Approved/suggested hotspot types include busy intersections, off-ramps, traffic stops, busy roads, public grass, and high-traffic poles/locations.
- Employees can submit hotspot and avoid suggestions; they become visible immediately as `Suggested` until reviewed.
- Maps distinguish suggested, approved, avoid, historic, current, voided-hidden, and low-confidence states with text/icons—not color alone.
- Guidance never implies legal permission or encourages camera use while moving/in traffic.
- Yard-sign analytics use `unique placement spot`, never `unique house`.
- Door-hanger protective default: exact coordinates/address retained for verification and Naldo/Jason review; non-owner team views round/aggregate residential locations. Exact residential details are not used on public-internal leaderboards. Owner must approve any broader exposure before launch.
- Photos and placement metadata are retained indefinitely, subject to documented legal hold/deletion/backup policy and storage-cost monitoring.

### Advertising metrics

- Accepted placements, unique spots after clustering approval, placements/run-hour, employee/campaign/town totals, hotspot coverage, repeated spots, GPS quality, queue failures, and run status.
- Pending/low-confidence/voided records are labeled and excluded or recalculated consistently.
- Internal-public means active YLL employees, never the internet.
- Leaderboards never expose exact locations, routes, private notes, customer/residential data, or pay.

## 7. Attendance and installer time

### Day clock and location

- Office, installer, and manager working shifts require Clock In/Out. Owner accounts punch only for a tracked employee shift.
- Manager selects work department. Ordinary employee department is automatic.
- Clock-in requires a location sample; no geofence. Clock-out location is recorded when available and missing/poor GPS is flagged rather than silently invented.
- Office/installers may record a break; managers need not record one. Advertising Placement Runs are separate.
- Device time, server time, GPS/accuracy, source, actor, and idempotency key accompany every punch.

### Canonical state machine

- Quote Tool canonical time may use one schema with explicit `entry_kind` and nullable `job_id`, or an equivalent contract-approved schema; the Quote Tool owns the choice and migration.
- `Clock In` opens the paid-day envelope and Route Mode.
- `Arrived` opens the job segment. `Departed` closes it.
- `Complete` closes an active job segment and requests Quote Tool operational completion.
- Starting break pauses/closes active job time and suspends route collection. Ending break resumes the day, not a job.
- `Clock Out` closes any open segment/break at punch time and flags review.
- Travel is the day-clock portion outside job/break/approved nonbillable segments and is counted once.
- Day partitions cannot overlap and must reconcile to total paid attendance. Gaps/unallocated time are visible.
- Separate Job Start/Stop controls are omitted unless a future contract defines a distinct plain-language meaning.
- Forgotten day clocks use Quote Tool midnight auto-close and review. This is independent of Placement Run closure.
- Jason/Naldo split, correct, approve, and lock. Managers comment/recommend only. Exported time is changed by later adjustment, never silent rewrite.

### Schedule gate

- Before clock-in: installer sees future/date/start-time/crew/preparation/workload summary.
- After canonical clock-in: same-day exact address, customer contact, route, navigation, and job controls unlock.
- The Quote API enforces the gate. Cached screens do not bypass it.
- A signed cached work packet may support an already-assigned employee after an offline clock tap and must say `Clock-in waiting to sync`.
- Owner emergency override has requester/approver/reason/start/expiry/employee audit.

### Route and visits

- Phase 3 guarantees one Quote-supplied route, open-in-navigation, large manual Arrived/Departed, and visible tracking gaps.
- Phase 5 may add consented foreground breadcrumbs and five-minute dwell suggestions after privacy/device calibration.
- PWA background tracking is best-effort and commonly interrupted by phone lock or native navigation.
- No suggestion becomes payable time without continuous acceptable evidence or employee/owner confirmation.
- Raw breadcrumbs stay in Hub for 120 days, then delete/aggregate unless legal hold. Approved visit/time summaries follow longer payroll retention.

### Completion photos

- Quote Tool owns the sole binary/reference and completion state.
- Before Phase 3, owner must approve required count, camera/gallery rule, GPS requirement, and exception path.
- Hub and Telegram use one Quote operation and idempotency key so a retry does not duplicate media or completion.
- Operational field completion is distinct from financial completion/collection.

## 8. P4P and employee performance

### Locked operating rules

- Shadow mode first; a deployment never changes wages by itself.
- One rotating install crew; eligible assigned workers share the job pool according to approved time/formula.
- Takedown remains hourly/outside install P4P for the current season.
- Weekly pay period, `America/New_York`.
- Current-week base pay remains current; performance clearing the seven-day window enters the following applicable payroll.
- Planning estimate and invoice-final/collection eligibility are separate; canonical Quote policy controls payout eligibility.
- Travel follows the one-time reconciliation rule.
- Quote Tool owner-restricted configuration holds membership/rates/percentages/language; Hub does not hard-code them.
- September 21, 2026 is the labor/time readiness target in Claude's source. Telegram-first time capture can be a fallback if approved; it must use the same ledger.

### Mandatory pay states

- `provisional`: display only as `Pending quality review` with close date.
- `earned`: quality window cleared.
- `forfeited`: qualifying documented job-specific quality event occurred before earning, with employee response/review.
- `paid`: included in locked payroll export.

Server returns state and `quality_window_closes_at`; the Hub does not infer it. No provisional amount appears in earned totals, payroll export, or wording such as earned/made/owed/paid. Only earned enters payroll export.

Quality transition uses the canonical completion event, New York timezone rule, race-safe server transition, immutable evidence, employee-readable reason/response, and Naldo/Jason finalization. It cannot deduct already-earned wages or create negative carry-forward. Rework affects efficiency but is not a wage deduction.

Qualified employment/payroll review is required before Phase 2 time/pay reporting because Claude's plan flags a possible current hourly-wage issue, and again before actual P4P enablement. This document is not legal advice.

### Employee views

Hours, approved jobs, Budgeted Hours versus actual, efficiency trend, provisional/earned/paid separated, clearing date, quality items/response, and approved team metrics. Individual pay amounts never appear on a public-internal leaderboard.

## 9. Telegram

- Quote Tool remains ingress for schedule/job/time/pay operations.
- Pairing/roster/routing/webhook/write controls are Naldo/Jason-only and audited.
- Same identity mapping, permissions, API, idempotency, audit, and pay vocabulary as Hub.
- Alerts may appear in both without duplicate business writes.
- Advertising launch scope: status and deep link to Hub Camera Mode. Start/end and verified placements remain Hub actions.

## 10. Cross-repository contract

Canonical after joint approval: `yll-quote-tool/docs/context/OPERATIONS_HUB_CONTRACT.md`. Hub keeps a versioned pointer/mirror. Contract/schema PR merges before consumer build.

Publish OpenAPI for:

- identity provisioning/mapping/deactivation/repair;
- `GET /api/ops/v1/me/day`, hours, stats, earnings, leaderboard, schedule;
- clock in/out and break start/stop;
- job arrive/depart/complete and completion photos;
- owner exception, approval, correction, quality, and export operations.

Every mutation includes authenticated actor, Hub employee ID, idempotency key, device time/timezone, source, app/device version, optional GPS/accuracy, expected version, and reason/evidence. Response returns canonical ID, accepted server time, enum state, source version, review flag, and safe error code. Same-key/same-payload returns the original; same-key/different-payload is rejected. Retain dedupe keys long enough to cover offline retry and record lifecycle policy.

Contract defines auth scopes, pagination, UTC timestamps/New York display, integer money units, enums, request limits, replay protection, webhook signatures, error/retry semantics, deprecation overlap, rollback, and owner.

## 11. Delivery tracks

After Phase 0, three tracks run in parallel.

### Phase 0 — contract/safety

Joint ownership matrix, identity contract, OpenAPI, auth/audit/idempotency, kill switches, production-route security audit, PWA cache policy, legal/payroll review, privacy decisions, and AGENTS ownership rules.

### Track A — Quote labor/time/schedule

Crew mapping, Budgeted Hours/labor inputs, canonical time schema/state machine, approvals/locks/adjustments, `/api/ops/v1`, scheduling/capacity, Telegram parity, P4P shadow/quality/pay export. Labor/time foundation targets September 21, 2026.

### Track B — Hub advertising/PWA

Auth/roles, campaigns, Placement Runs, camera/GPS, durable queue, numbering/stamping, feed/map/export, then hotspots/avoid/unique spots.

### Track C — Hub office/install UI

Rename/preserve Call Copilot, basic day time, schedule gate/route/manual visits/completion, reporting, then foreground dwell suggestions.

P4P actual-pay enablement is last and feature-flagged. External Copilot CRM/Homeworks may be canceled only after schedule/time replacement, two clean reconciliation weeks, and confirmation that remaining reports/QuickBooks/customer-portal needs are covered. YLL Call Copilot itself is the codebase being preserved/renamed.

## 12. Verification and launch gates

- Authorization matrix on every route and object.
- Identity partial-failure/deactivation/rehire.
- Idempotent duplicate/conflicting retries.
- Offline capture, close/reopen, denied permission, no GPS, low storage, OS eviction disclosure, out-of-order uploads, and two-device conflict.
- Atomic finalize and orphan cleanup.
- One-tap camera return, X+Undo, midnight forgotten run, five-minute placement Undo, stamped/original output.
- GPS accuracy display/review and geospatial distance tests.
- Day/job/break/travel reconciliation, DST/midnight, overlaps, offline clock, export adjustment.
- Manual visit, background interruption, no unsupported automatic-pay behavior.
- Seven-day boundary/race, integer money, forbidden provisional wording, quality response, export lock.
- Accessibility: 44-point targets, VoiceOver/TalkBack labels, text/icon states, text scaling, daylight contrast, visual + optional haptic/audio capture confirmation.
- Security: route/webhook/cron fail-closed, log redaction, logout/cache clearing, key rotation, replay, access logs.
- Backup/restore and data-retention jobs.

## 13. Remaining feature-gated owner decisions

- Exact completion-photo count/camera/gallery/GPS rule.
- Final door-hanger residential address/photo visibility beyond the protective default.
- Unique-spot clustering distance/time before ranking.
- Poor-GPS exception threshold after device calibration (20 m review is the default).
- Maximum offline queue and storage warning thresholds.
- Clock-gate emergency packet/override details.
- Final P4P rates, pool configuration, weather/off-season/takedown future policy, counsel/payroll approval, notices, and rollout cohort.

No undecided wage, privacy, surveillance, or authorization behavior is silently enabled. The relevant feature remains off or uses the stated protective default.
