# Yule Love Lights Operations Hub — Canonical Product Specification

Version: 1.0-draft-for-Claude-review  
Date: 2026-08-06

This is the authoritative Hub-side behavior specification. `MASTER-PLAN.md` explains delivery and architecture. If an older Codex document conflicts with this file, this file wins. Cross-repository job/time/pay behavior becomes final only when the Quote Tool's canonical contract matches it.

## 1. Product and repositories

- YLL Call Copilot is renamed and expanded into Yule Love Lights Operations Hub at `ops.yulelovelights.com`.
- The Hub is the employee UI and the system of record for advertising.
- The Quote Tool is the system of record for customers, jobs, schedule, canonical labor time, Budgeted Hours, completion, P4P, and payroll exports.
- Quote Tool assistant owns shared labor schema/API migrations. Hub assistant owns Hub auth/UI/advertising/route-evidence schema. Neither edits the other's owned schema without an explicitly assigned PR.

## 2. Access

- Sign-in: invite-only phone + one-time PIN.
- Identity admins: Naldo and Jason only.
- Departments: Office, Advertising, Install, Management/Owner. One employee department at a time.
- Managers clock in/out and choose management work context. Owners punch only when performing a tracked employee shift.
- Only Naldo/Jason approve or change canonical time and compensation settings.
- `Public` means visible to active YLL employees only.

## 3. Source-of-truth contract

| Business fact | Authority |
|---|---|
| Hub login, role, department, active state | Operations Hub |
| Advertising campaign/run/placement/photo/hotspot/avoid | Operations Hub |
| Raw route breadcrumb/device evidence | Operations Hub |
| Customer/quote/job/schedule/assignment | Quote Tool |
| Labor worker/Budgeted Hours/labor revenue | Quote Tool |
| Day/job time, break/travel, approval/payroll lock | Quote Tool |
| Operational job completion and completion-photo reference | Quote Tool |
| P4P calculation/quality/earned/paid/export | Quote Tool |

One immutable employee mapping joins Hub auth, Quote crew, phone, and Telegram identity. Every cross-app mutation is authenticated, authorized, idempotent, versioned, and audited.

## 4. Advertising acceptance contract

### Start/return/end

- Home shows one Start button for every assigned campaign.
- One tap starts the chosen campaign and opens Camera Mode.
- New run requires connectivity; a confirmed run continues/ends offline.
- While active, reopening the installed PWA goes directly to Camera Mode; a single permission tap is allowed only when required by the OS.
- X ends immediately, returns Home, and offers short Undo.
- Local-midnight reconciliation closes a forgotten run at its last durable shutter time. Zero-photo run becomes abandoned/review.
- Explicit run rate uses start-to-X; auto-closed rate uses start-to-last-durable-photo. End reason is shown.

### Capture

- Live camera is required for verified placement; gallery is unverified/admin-only if ever enabled.
- Shutter persists original + metadata before camera resets.
- Next shutter is immediately available; note is optional and nonblocking.
- Required metadata: employee, campaign, run, capture time, latitude/longitude, reported accuracy, GPS sample time, camera provenance, device/idempotency ID, derived address, and permanent Sign Number after server acceptance.
- Server stores original and creates stamped derivative/thumbnail. Stamp: date/time, address, GPS accuracy, `Sign Number`.
- Sign Numbers restart at one per campaign, allocate atomically in server-acceptance order, never change, and never reuse.
- Feed sorts by capture time; offline card says `Number pending`.
- Employee can Undo own latest placement for five minutes; soft void remains audited and creates a permanent number gap.
- Blur does not fail; missing GPS cannot be verified.

### GPS

- 0–5 m excellent, >5–10 m good, >10–20 m accepted/labeled, >20 m review, none unverified.
- Accuracy is always displayed; no false exactness.
- Missing fix can be joined only during short same-camera/stationary grace; log time delta. Later unrelated location is forbidden.
- Naldo/Jason resolve poor/no-GPS exceptions.

### Offline

- Queue states: Pending, Uploading, Uploaded, Needs Attention, Failed.
- Retry/Retry All available; automatic retry while active and resume on reopen.
- Durable storage is best effort across normal close/restart; warn about low storage and pending work. Never promise against uninstall, site-data clear, device loss, or OS eviction.
- Duplicate retries return the original placement.
- Finalization of media, placement, number, derivatives, audit/outbox is atomic/recoverable.

### Map and visibility

- Assigned worker sees own placements and assigned-campaign operational map.
- Active YLL employees see approved internal leaderboard totals, not exact private routes/residential data/pay.
- Naldo/Jason see exact placement/GPS/photo/audit and review queues.
- Hotspot/avoid suggestions appear immediately as Suggested; managers see them; Naldo/Jason approve.
- Yard-sign locations are unique placement spots, not houses.
- Door-hanger exact residential data defaults to Naldo/Jason-only after verification; employee-facing maps aggregate/round it until owner approves a broader rule.
- No retrieval/removal workflow in V1.

## 5. Time and installer acceptance contract

### Day state

- Office/install/manager: Clock In -> optional Break -> Clock Out.
- Clock-in records GPS; no geofence. Clock-out records GPS when available and flags missing/poor location.
- Quote Tool accepts/rejects canonical state; Hub shows Saved on phone, Waiting to sync, Accepted, Needs review, or Rejected.
- Midnight auto-close protects forgotten payroll clock-outs and creates review.

### Reconciliation

- Day clock is paid-attendance envelope.
- Arrived/Departed form job segments. Complete closes active segment and requests operational completion.
- Break pauses/closes job and route collection; break end does not reopen job.
- Travel is day time not in job/break/nonbillable segments and counts once.
- No overlaps; partitions reconcile to day total; gaps are visible.
- Clock Out closes open state and flags review.
- Jason primary/Naldo backup approve, correct, split, lock; managers comment only.
- Exported records change by adjustment, never rewrite.

### Schedule/route

- Before clock-in: non-sensitive upcoming summary.
- After accepted clock-in: exact same-day address/contact/route/job controls.
- Quote API enforces gate. Audited offline packet/owner override is exceptional.
- Phase 3 guarantees manual Arrived/Departed and visible tracking gaps.
- Five-minute dwell is a Phase 5 foreground suggestion, never unquestionable payable time.
- Raw route points expire after 120 days; approved time/visit summaries use payroll retention.

### Completion

- Quote Tool stores the sole completion state/media reference.
- Operational completion is separate from financial completion.
- Hub/Telegram use same idempotent Quote operation.
- Required photo count, gallery/camera, and GPS remain off until owner approves the exact rule.

## 6. Pay display contract

- `provisional` -> copy exactly `Pending quality review`; show close date.
- `earned` -> cleared after seven-day quality window.
- `forfeited` -> documented qualifying event before earning, with employee response/review.
- `paid` -> included in locked payroll export.
- Never call provisional money earned, made, owed, paid, or include it in earned totals/leaderboards/export.
- Quote server supplies states/timestamps/integer money; Hub never calculates them.
- Only earned enters payroll export.
- Shadow mode and qualified legal/payroll approval precede any actual pay change.

## 7. Telegram contract

- Quote Tool bot owns job/time/pay ingress and uses same API/identity/idempotency/audit/pay wording.
- Naldo/Jason alone administer pairing, routing, webhooks, and write access.
- Advertising V1: status + camera deep link only. Start/end/capture remain Hub actions.

## 8. Retention and safety

- Placement original/derivative/metadata: indefinite, with backup, legal hold, cost monitoring, and authorized deletion policy.
- Raw route points: 120 days, then delete/aggregate unless legal hold.
- Time/pay/quality/audit: approved longer payroll/legal retention.
- Exact GPS, addresses, route trails, pay, private notes, and signed media are role-restricted and access-logged.
- Camera/map warns against operation while moving. High-accuracy advertising GPS runs only during visible capture use.
- PWA never promises continuous background tracking or upload while closed.

## 9. Required release order

1. Joint ownership + identity + OpenAPI + security/audit/idempotency contract.
2. Parallel: Quote labor/time foundation; Hub advertising PWA; Hub office/auth rename.
3. Installer schedule/manual visits/completion and two-week reconciliation.
4. Advertising intelligence and calibrated route suggestions.
5. P4P shadow, quality workflow, legal/payroll validation.
6. Feature-flagged actual P4P only after explicit approval.

External Copilot CRM/Homeworks cancellation requires complete time/schedule parity, two clean weeks, and remaining integration/report review. YLL Call Copilot is preserved as this Operations Hub.

## 10. Final blockers before affected features turn on

- Quote-side canonical OpenAPI/schema contract approved by both assistants.
- Exact installer completion-photo rule.
- Door-hanger residential visibility beyond protective default.
- Field-calibrated GPS and unique-spot thresholds.
- Offline queue/storage limit.
- Emergency clock-gate policy.
- P4P rates/policies, current wage review, counsel/payroll approval, employee terms, and rollout decision.

All other behavior in this file is the accepted implementation target. A blocker disables only its affected feature; it does not authorize an assistant to invent a wage, privacy, surveillance, or permission rule.
