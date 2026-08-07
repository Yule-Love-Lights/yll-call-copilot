# Yule Love Lights Operations Hub — Codex Product and Technical Plan

> **Status:** Codex working plan, ready for comparison with Claude's plan but not yet the joint master plan
>
> **Last updated:** 2026-08-06
>
> **Current repository:** `Yule-Love-Lights/yll-call-copilot`
>
> **Approved future repository name:** `Yule-Love-Lights/yll-operations-hub`
>
> **Approved product name:** Yule Love Lights Operations Hub
>
> **Approved production domain:** `ops.yulelovelights.com`

## 1. Purpose of this document

This is the complete Codex-side plan for expanding the existing YLL Call Copilot into the Yule Love Lights Operations Hub. It records confirmed product decisions, proposed architecture, data ownership, workflows, permissions, risks, acceptance criteria, and unresolved implementation validations.

This document intentionally does **not** incorporate Claude's separate plan yet. When that plan is made available, the two plans should be compared section by section and merged into a new `MASTER-PLAN.md`. Neither plan should silently overwrite the other.

## 2. Product vision

The Operations Hub is the role-based internal operating system for Yule Love Lights employees:

- **Office employees** keep the existing call, coaching, and office-performance tools and use attendance tracking.
- **Advertising employees** run yard-sign and door-hanger campaigns using fast, GPS-verified camera capture, Placement Runs, maps, hotspots, and performance reporting.
- **Installers** see assigned Quote Tool jobs, clock in and out, optionally record unpaid breaks, follow their route, generate automatic job visits, upload completion photos, and update operational job status.
- **Managers** clock in and out and can see all departments and operational reporting.
- **Naldo and Jason** are the only principals who manage employee identities/roles and approve or edit time records.

The Operations Hub works directly alongside the YLL Quote Tool. The Quote Tool remains the source of truth for customers and installation jobs. The Operations Hub becomes the source of truth for employees, field activity, attendance, route evidence, placements, and operational performance.

The existing office/call capabilities are not being removed. They become one department-specific area inside the larger Operations Hub.

## 3. Confirmed boundaries and non-goals

### Included

- Rename the Call Copilot repository and visible product to Operations Hub.
- Host at `ops.yulelovelights.com`.
- Preserve existing Call Copilot functionality.
- Phone-number sign-in using a one-time PIN/OTP.
- Strict role- and department-based home screens.
- Campaigns for yard signs and door hangers.
- GPS-required, camera-only placement capture.
- Placement Run timer and rapid repeated capture.
- Offline upload queue with automatic retry.
- Original and stamped photo retention.
- Maps for placements, historical placements, assignments, good hotspots, and avoid areas.
- Attendance for office employees, installers, and managers.
- Installer route/job-visit tracking with explicit browser limitations.
- Quote Tool bidirectional operational synchronization.
- Telegram notifications and selected audited actions.
- Internal leaderboards and data export.

### Explicitly excluded or deferred

- Importing existing SimpleCrew photographs.
- Sign retrieval tracking.
- Payroll-ready calculations, overtime rules, rounding, or payroll exports in the first version.
- Guaranteed all-day background location in a browser/PWA.
- App Store distribution in the first version.
- Automatic financial completion, invoice completion, or payment changes when an installer marks operational work complete.
- Ordinary gallery uploads by advertising employees.
- Claims that historical placements prove a sign still physically exists.

## 4. Existing application baseline

The current repository is a Next.js 16 / React 19 / Supabase application named YLL Call Copilot. It contains live office workflows including call queues, playbooks, coaching, practice, call review, digest, scoreboard/board, and related settings.

Important migration facts:

- Current sign-in is email/password with an `app_users` allowlist.
- Current roles are oriented around `rep`, `admin`, and `owner`.
- Current server data access relies heavily on the Supabase service role.
- The repository README says row-level security is not yet fully implemented.
- The current proxy can allow the application through when browser-side Supabase configuration is missing; production Operations Hub access must instead fail closed.
- Current product labels, metadata, navigation, setup scripts, and deployment configuration use the Call Copilot name.

The Operations Hub migration must preserve current office users and data while introducing a canonical employee identity, phone OTP, departments, field permissions, and row-level security.

## 4A. SimpleCrew/reference-product research captured so far

The signed-in SimpleCrew trial and its public product/API material were reviewed to understand behavior, not to copy proprietary assets or source.

Observed SimpleCrew capabilities:

- Active, archived, and deleted campaigns
- Campaign name/description, member assignment, photo total, and leaderboard
- Mobile field camera with persistent preview, campaign selector, flash/camera controls, recent captures, optional notes, asynchronous address lookup, and repeated capture
- Photo timeline grouped by date, employee, timestamp, address, note, and map location
- Photo detail, copy/download, and map actions
- Filters for date, GPS/non-GPS, and team member
- Exports including CSV, XLSX, JSON, ZIP, and PDF
- Shareable campaign toggle
- Profile photo feed and map view
- Team roles such as Agent/Admin/Owner
- Reports such as photos by employee
- Failed-upload recovery and optional save-to-gallery setting
- Webhooks for new campaign and new photo
- API resources for campaigns and photo/log uploads

SimpleCrew's upload API accepts metadata including caption, camera/library source, campaign, original date/time, camera/software metadata, filename, retry information, latitude/longitude, and upload ID. Its returned log records include user, upload time, coordinates, timestamp, filename, source, caption, place/address, campaign, comments, and image variants. This validates the need for explicit source, fresh GPS, idempotent upload ID, and separate original/derived media in our own design.

TrackEveryYardSign was also reviewed as a mapping reference. Useful concepts include a placement map, drive mode, landmarks/notes, and routing to nearby suggested placements. These are functional references only; Operations Hub will use original YLL workflows and design.

No SimpleCrew photos will be imported.

## 4B. Known Quote Tool operational overlap to preserve

This is current-system context, not Claude's separate plan:

- The Quote Tool is the established system for customers, quotes, jobs, schedules, assignments, designs, and inventory-related operations.
- Its Telegram layer already supports operational reads such as schedule/jobs/stock and selected write workflows.
- Existing installer-completion behavior can attach completion evidence/material actuals but deliberately avoids financial/invoice completion.
- Telegram roles/allowlists and audit/confirmation mechanisms already exist but must be unified with Operations Hub identity and strengthened rather than duplicated.

Before implementation, the current code—not an old planning description—must be treated as evidence of what is live.

## 5. Product principles

1. **One role, one relevant home.** Employees should not navigate through departments they do not work in.
2. **Field speed is load-bearing.** Taking the next placement photo must not wait for reverse geocoding, stamping, or uploading.
3. **Evidence is explicit.** GPS accuracy, source, timestamps, and audit history are stored; the system never pretends a weak location is exact.
4. **Offline is a normal state.** Captures remain safe on the device until the server confirms upload.
5. **Permissions apply equally everywhere.** PWA, Telegram, system jobs, and Quote Tool sync use the same authorization rules and audit model.
6. **Each shared field has one owner.** Bidirectional sync does not mean two systems can overwrite the same field unpredictably.
7. **Operational completion is not financial completion.** Installer completion must not silently complete an invoice or financial workflow.
8. **Historical evidence is not live inventory.** A placement photo proves that a placement happened, not that the sign remains there.
9. **Use YLL's own design.** Reproduce SimpleCrew's efficient interaction pattern, not its branding or pixel-for-pixel visual design.

## 6. Roles, departments, and permissions

Each ordinary employee belongs to one department. Manager access is a cross-department exception.

| Persona | Home experience | Read access | Write access |
| --- | --- | --- | --- |
| Naldo/Jason (owner/admin principals) | Executive Operations Hub | All departments, employees, time, routes, placements, integrations, exports, audit | All configuration; employee/role management; time correction/approval; all manager actions |
| Manager | Manager dashboard | All departments and internal leaderboards | Clock own time; manage campaigns/hotspots; review placements and field operations; cannot change employee roles or approved time |
| Office employee | Existing office/call workspace plus own attendance | Own office work, own time, appropriate internal leaderboard | Clock in/out, optional break, existing office actions |
| Advertising employee | Assigned campaigns, Placement Run, camera, placement map, hotspots, leaderboard | Assigned campaigns, permitted team placement information, internal performance | Start/end run, capture/undo own placement, add good/avoid hotspot suggestions |
| Installer | Today's route, assigned jobs, time, completion, team status | Own assignments/route/time; relevant job/customer details; permitted team status | Clock in/out, optional break, complete assigned work, photos, visit corrections/selection |
| Telegram/system integration | No human UI | Only data needed for scoped action | Only explicit service actions with source attribution and audit |

Additional rules:

- Only Naldo and Jason can create/deactivate employees, assign roles/departments, link phone numbers, and approve/edit time.
- Managers can see everything operationally but do not inherit owner-only mutations.
- “Public” means visible to authenticated Yule Love Lights employees, never publicly accessible on the internet.
- Public internal leaderboards never expose customer addresses or detailed route trails.
- Customer addresses are visible to assigned installers and managers/admins only.
- Detailed installer route history is visible to that installer and managers/admins, not unrelated coworkers.

## 7. Authentication and employee lifecycle

### Confirmed sign-in

- Employee enters a phone number.
- System sends a one-time PIN/OTP.
- Employee enters the code and receives an authenticated session.
- There is no public self-signup.
- The phone number must already be linked to an active employee created by Naldo or Jason.

### Required implementation safeguards

- Normalize phone numbers to E.164.
- Rate-limit OTP requests and verification attempts.
- Do not reveal whether an unknown phone number belongs to an employee.
- Maintain a canonical `employee_id` separate from auth-provider identifiers.
- Authorize by the Supabase Auth UUID/canonical employee link, never by email text alone.
- Link existing office email identities to the new canonical employee record before migration.
- Support lost/reassigned phone recovery through owner/admin verification.
- Deactivation revokes sessions and prevents new OTPs immediately.
- Deactivation also revokes Telegram pairing and integration credentials associated with the employee.
- Because an already-issued token may remain valid until expiry, every protected API and storage decision must also verify the canonical employee remains active; session revocation alone is insufficient.
- Audit account creation, role/department changes, phone changes, recovery, deactivation, and reactivation.
- Define multi-device behavior; recommended default is to allow multiple devices but show/revoke active sessions.
- Owners need a recovery method that does not depend only on the lost phone.

Supabase Phone Auth plus an SMS provider is the likely implementation, but provider configuration, delivery cost, and production verification must be validated before launch.

## 8. Navigation and role-based home screens

### Office employee

- Existing Call Copilot/Coach features
- Own attendance status
- Office performance and appropriate internal leaderboard
- No advertising or installer controls

### Advertising employee

- Large `Start Placement Run` action
- Assigned active campaigns
- Current placement totals and placements/hour
- Placement/hotspot map
- Upload status and failed uploads
- Internal placement leaderboard

### Installer

- `Clock In` / `Clock Out`
- Optional break control
- Today's assigned route and jobs from Quote Tool
- Current route/job-visit state
- Upcoming/completed work
- Completion photo/action controls
- Relevant inventory and budget-vs-actual information when available

### Manager/admin

- Prominent personal `Clock In` / `Clock Out` status and action
- Department filters and cross-department metrics
- Campaign and assignment administration
- Employee administration according to permission
- Time and route exception queues
- Placement GPS review
- Upload and synchronization health
- Export center and audit log

## 9. Advertising campaigns

### Campaign model

- Managers/admins can freely create campaigns.
- Launch campaign types are `yard_sign` and `door_hanger`.
- Initial examples include Christmas yard signs, permanent yard signs, and Christmas door hangers.
- Campaigns have active, archived, and optionally deleted/voided states.
- Advertising employees see only assigned campaigns.
- Each campaign has its own increasing Sign Number sequence starting at 1.
- A Placement Run belongs to exactly one campaign; employees cannot switch campaigns mid-run.
- To work another campaign, the employee ends the current run and starts a new one.

### Campaign administration

- Name, type, description/instructions, status, start/end dates
- Assigned employees
- Current Sign Number sequence
- Placement totals and members
- Map, feed, and leaderboard
- Hotspots/avoid guidance associated with the campaign or shared across campaigns
- Export and archive

## 10. Placement Run state machine

### Inactive

- Opening the PWA shows the employee's normal advertising dashboard.
- If the employee has one assigned campaign, a prominent `Start Placement Run` button starts that campaign in one tap.
- If the employee has multiple assigned campaigns, the dashboard shows a large campaign-specific start action for each one, such as `Start Christmas Yard Signs` and `Start Christmas Door Hangers`.
- One tap selects the campaign, starts the timer, and opens Camera Mode.

### Starting

- Recommended launch rule: starting a **new** Placement Run requires connectivity so the server can verify the active employee and campaign assignment, enforce one open run per employee, and record server/device start times. This still needs owner approval.
- The server creates the run with a unique ID and enforces one active run per employee using a database constraint/transaction.
- The run timer begins.
- The run's campaign is locked.
- Camera Mode opens immediately.
- High-accuracy GPS sampling begins immediately.

### Active

- Every PWA launch redirects directly to Camera Mode.
- Closing or backgrounding the PWA does not end the timer.
- The camera hardware stops when the PWA closes, but restarts when the active page reopens.
- The timer includes setup, driving, travel between signs, and placement work.
- After an online start, an already-active run and its cached campaign authorization can continue capturing offline. A new OTP or session refresh is not required for each photo.
- On reconnect, the server revalidates employee/campaign status. If the employee was deactivated while offline, queued evidence is quarantined for admin review rather than silently discarded or accepted into normal totals.
- Camera Mode displays the fixed campaign name; it does not offer an in-run campaign switch.
- Camera Mode provides in-context access to upload state, hotspot/map guidance, and required settings without ending the run.

### Explicit ending

- The camera's top-left `X` means `End Placement Run`.
- One tap ends the run, exits forced Camera Mode, and returns to the advertising dashboard.
- A short `Undo End Run` action protects against accidental taps.
- Explicit end time is the X timestamp, so time after the last photograph remains part of the deliberate run.
- If X is tapped offline, local state immediately stops forced Camera Mode and queues the end event for idempotent synchronization.

### Forgotten-run reconciliation

Confirmed: a forgotten run ends at its last picture. The exact reconciliation trigger and zero-photo behavior remain pending approval.

Proposed implementation:

- At local midnight, reconcile any still-open run.
- Anchor the end to the last photo durably persisted on the device/server by shutter capture time, not upload time or later manager approval, so offline and GPS-review delays do not distort the timer.
- If the run contains no photos, void it and exclude it from productivity calculations.
- Show auto-closed/voided runs in an admin exception log.
- Until reconciliation occurs, reopening the PWA continues to enter Camera Mode as required.

### Placement Run reporting

- Store `started_at`, `first_placement_at`, `last_placement_at`, `ended_at`, and `end_reason` separately.
- Run duration = explicit end minus start, or last locally persisted shutter capture minus start for an auto-closed run.
- Placements/hour = accepted placements divided by run duration.
- A separate placement-window diagnostic (start through last placement) may be displayed later but does not replace the confirmed run timer without owner approval.
- Travel between placements is included.
- Advertising Placement Runs are productivity sessions, not payroll time punches.

## 11. Camera Mode

The screenshots supplied by the owner establish the interaction pattern:

- Full-height live camera preview
- Campaign name at top
- End Run (`X`) control
- Flash control when supported
- Large shutter button
- Front/rear camera control
- Recent captures visible without leaving the camera
- Asynchronous address/GPS status
- Optional note per capture
- Upload/retry state

### One-shutter capture pipeline

When the employee presses the shutter:

1. Freeze a new camera frame from the live camera stream.
2. Attach the freshest acceptable GPS sample close to the shutter time.
3. Generate a unique capture/upload identifier.
4. Save the untouched original and metadata into the durable local queue.
5. Show immediate visual/haptic confirmation.
6. Reset the shutter for the next photo without waiting.
7. Upload, assign the permanent Sign Number, reverse-geocode, stamp, and index asynchronously.

Address lookup, image stamping, and remote upload must never block the next shutter.

### Camera-only safeguard

- Advertising Camera Mode uses a live in-page camera stream.
- It does not expose a normal file/gallery picker.
- GPS is sampled at capture rather than trusted from EXIF.
- Server/device timestamps and source are recorded.
- A manager-only recovery-upload path may be added later; it must be visibly marked and excluded from verified counts until approved.
- No software can prevent a worker from pointing the camera at an image on another screen, but the design prevents normal old-gallery-photo reuse and preserves audit evidence.

### Undo

- Employee can undo their own most recent placement for five minutes.
- Undo is a soft void, not destructive deletion.
- Voided Sign Numbers are never reused.
- Manager/admin actions retain the original audit trail.

## 12. GPS and location policy

### Confirmed accuracy levels

- **Target:** 1–5 meters
- **Verified:** up to and including 10 meters
- **Flagged:** more than 10 meters through 20 meters
- **Review required:** more than 20 meters after retry

The accuracy value is a radius around the reported point, not exact pole-level certainty. The original accuracy value must always remain visible in metadata.

### Capture behavior

- Start high-accuracy sampling when Camera Mode opens, not after the shutter.
- Prefer the freshest best-accuracy sample within a short shutter window.
- Recommended initial rule: GPS sample no older than 10 seconds at shutter time.
- More than 20 meters triggers a brief retry state, then offers `Submit for review` or cancel.
- Denied location permission blocks verified placement capture and explains how to enable it.
- If the phone returns no coordinate, keep the photo locally as `Missing GPS — not submitted`, allow an immediate GPS retry without retaking the photo while the employee remains at the spot, and do not count it as a placement until resolved.
- Missing-GPS recovery is time-bound to the same active run, device, and camera context. Store the photo-to-location time delta. After a short grace period, or once the employee continues/moves away, never attach a later coordinate silently; require a retake or preserve the image as permanently unverified recovery evidence.
- Recommended pending approval: managers review placement accuracy, pending-review placements appear on the manager map, and they do not count in verified leaderboard totals until approved. Time-edit authority remains only with Naldo/Jason regardless.

The exact retry duration, stale-sample window, and review approver are launch configuration values that must be tested on real field devices.

## 13. Placement numbering and offline conflict handling

Campaign Sign Numbers must be unique, increasing, atomic, and never reused.

Multiple offline phones cannot independently know the same campaign's next permanent number. The recommended implementation is:

1. Give every capture an immediate local upload ID.
2. Keep the UI moving without waiting for the server.
3. On successful server synchronization, allocate the next campaign Sign Number in an atomic database transaction.
4. Generate the stamped version after the permanent number is assigned.
5. Preserve the original photograph separately.

This means an offline capture can briefly display `Number pending`. Permanent numbers follow server acceptance order, which may differ from capture order after long offline periods.

An alternate future optimization is reserving number blocks per device, but it creates unused gaps and more synchronization complexity. Gaps caused by voids, failed captures, or reserved numbers are acceptable; duplicate/reused numbers are not.

## 14. Placement record and image requirements

Each placement stores at minimum:

- Placement ID and idempotency/upload ID
- Campaign ID and permanent Sign Number
- Employee ID and Placement Run ID
- Capture source (`verified_camera`, future `manager_recovery`)
- Device capture time, server received time, and upload completed time
- Latitude and longitude
- GPS accuracy radius and GPS sample timestamp
- Reverse-geocoded address/description when available
- Optional note
- Original image storage key, checksum, size, dimensions, and MIME type
- Stamped image storage key and checksum
- Upload state and retry count
- GPS verification/review state
- Active, voided, or deleted/archived state
- Audit actor/channel and timestamps

### Stamped image overlay

- Date and time
- Address/location label
- GPS accuracy
- Sign Number

Both original and stamped versions are retained indefinitely. Storage lifecycle cost, backup, restore, and offboarding policies must be monitored even though product retention is indefinite.

## 15. Offline upload architecture

Offline capture is a first-class workflow:

- Originals and metadata are written to IndexedDB or equivalent durable browser storage before success is shown.
- Request persistent browser storage where supported, but do not claim protection against OS eviction, app uninstall, browser-data clearing, or device loss.
- Queue states: `queued`, `uploading`, `uploaded`, `failed`, `review_required`, `voided`.
- Camera Mode shows an always-visible compact queue summary such as `3 queued`, `1 uploading`, or `1 needs review`.
- Uploads use resumable/idempotent behavior where possible.
- A retry with the same upload ID cannot create a second placement.
- Server validates checksums and ownership.
- The PWA retries automatically when connectivity returns and when reopened.
- `Failed Uploads` shows actionable errors and manual retry.
- Provide individual retry and `Retry all` controls.
- Do not allow sign-out or local-data clearing without warning about pending uploads.
- Warn when local storage is low.
- Define queue byte/item limits; warn and eventually refuse additional capture before storage exhaustion can corrupt evidence.
- Remove the local original only after the server confirms durable receipt and metadata commit.

Required device testing includes iOS/Android storage eviction, weak cellular service, large queues, app termination, permission changes, browser upgrades, logout, and repeated retry.

### Upload finalization contract

- Upload the original under a temporary object key tied to the client upload ID.
- Validate ownership, type, dimensions, size, checksum, and GPS/campaign metadata.
- Finalize idempotently: create/lock the placement, atomically assign its campaign Sign Number, record the original, and enqueue derived-image work.
- Generate stamped image and thumbnails after successful finalization.
- A retry of any step returns the same placement/number rather than allocating another.
- Garbage-collect abandoned temporary objects after a safe recovery window without deleting evidence still referenced by a pending client queue.

### PWA cache and sensitive-data rules

- Cache only versioned static shell assets needed to launch the UI.
- Treat authenticated HTML, API responses, OTP/auth endpoints, signed photo URLs, customer addresses, and route/time data as network-only/`no-store`.
- Clear user-scoped local views and protected caches on logout while preserving/quarantining pending uploads through an explicit safe workflow.
- Version and invalidate old Call Copilot service-worker caches during the Operations Hub/domain cutover.
- Test stale service-worker upgrades, account switching, lost/shared phones, logout, and offline reopen.

## 16. Placement maps, hotspots, and avoid areas

### Placement terminology

Yard signs are placed at high-traffic public placement spots, such as busy intersections, traffic stops, busy roads, telephone poles, public grass near intersections, and similar locations. They are not customer-house placements.

Door-hanger location/privacy behavior still needs to be explicitly reconciled with this terminology before implementation because door hangers normally involve residences. This is a documented review gap, not an assumption to hide.

### Map layers

- Recent verified placements
- Historical placement evidence, visibly aged/dimmed
- Good/recommended hotspots
- Avoid/restricted areas without using a crude X marker
- Installer assignments/routes only for permitted roles
- Campaign and date filters

### Hotspot model

Employees can immediately add both good and avoid suggestions. Manager approval is not required for visibility, but managers can edit, merge, archive, or moderate them.

Immediate visibility does not imply proof: employee-created records are labeled `Crew suggestion — unverified` until a manager or future performance model adds stronger evidence.

Each hotspot/avoid record supports:

- Point, intersection, road segment, or area geometry
- Good/recommended or avoid/restricted classification
- Creator and source (`employee_suggestion`, `manager`, future `performance_model`)
- Notes and optional photo
- Priority/confidence
- Created/updated time
- Optional expiration/staleness
- Campaign applicability

Suggested locations must be visibly distinct from later data-proven hotspots. Campaign instructions should include safety and local placement restrictions so the interface does not appear to endorse unsafe or prohibited behavior.

### Field safety

- Campaign instructions explicitly require employees to stop safely before taking photographs or operating the map.
- When reliable speed evidence is available, the UI warns against capture while moving but does not treat browser speed as perfect proof.
- Recommended, avoid, unverified, and restricted states use labels/icons as well as color.
- Current-location markers show their observation time and become visibly stale rather than appearing falsely live.

### “Unique placement spot” metric

- Every accepted photo is a placement.
- Repeating a prior spot is a new placement and triggers no duplicate warning.
- A secondary unique-spot metric may cluster nearby coordinates, but it is never the primary leaderboard metric.
- Its clustering radius must be defined and disclosed before use.

## 17. Attendance and timekeeping

### Who uses payroll-style attendance

- Office employees: clock in/out; optional unpaid break
- Installers: clock in/out; optional unpaid break
- Managers: clock in/out; no required break
- Advertising employees: Placement Runs only, not payroll attendance in this scope

### Punch rules

- Clock-in requires a current GPS snapshot. Capturing a clock-out location is recommended but still needs explicit owner confirmation.
- There is no geofence; employees may punch from any location.
- Store device time, server time, coordinates, accuracy, source, and device/session.
- Clock-out stops installer Route Mode.
- Clocking out mid-route or with an active visit/break creates an exception for end-of-day review.
- Only Naldo/Jason can edit or approve time.
- Employee corrections are requests, not direct mutations of approved time.
- Every edit records before/after values, reason, actor, channel, and timestamp.

### Exception workflow required for launch

- Forgotten clock-out
- Duplicate punch
- Clock-out before clock-in
- Open break at clock-out
- Active job visit at clock-out
- Overnight shift/daylight-saving behavior
- Employee correction request
- Owner/admin approve, reject, comment
- Approved-period locking and explicit reopen

Recommended defaults:

- Route stops at clock-out.
- Active visit ends at the punch time and is flagged.
- Open break ends at the punch time and is flagged.
- Forgotten shifts remain open and generate reminders/review; they are not silently converted into payroll-ready time.
- All storage uses UTC; display and business-day grouping use the configured YLL timezone.

## 18. Installer route and job-visit tracking

### Confirmed intent

- Quote Tool supplies assigned installation jobs, addresses, route/order, schedule, and budgeted hours.
- Route Mode starts automatically when an installer clocks in.
- Staying at a known job location for more than five minutes creates an automatic job visit.
- Arrival/departure and time at the job are recorded.
- If multiple nearby jobs are plausible, the installer selects the correct one.
- Installers can upload completion photos and operationally complete work.
- Clock-out stops the route and flags inconsistent/open state for review.

### Browser limitation

A PWA cannot guarantee continuous background location after the phone is locked, the page is hidden, or the browser suspends it. Version one must be described honestly as foreground Route Mode with gap detection and corrections. A future lightweight native wrapper can provide dependable background location permission without rebuilding the product UI.

Clock-in/out remains the authoritative attendance record. Route-derived arrivals and departures are operational evidence and suggestions when tracking is incomplete; they do not silently become payroll truth. A five-minute automatic visit requires sufficient continuous foreground evidence; otherwise it remains a suggested visit until the installer confirms it. Installers receive one-tap GPS-backed `Arrived` and `Departed/Complete` fallbacks when automatic evidence is missing. Opening Apple Maps or Google Maps is an explicit test case because it backgrounds the PWA during navigation.

### Initial visit-detection proposal

- Consider only assigned/current jobs by default.
- Enter a visit candidate when acceptable points remain within a configurable radius.
- Require five minutes of dwell before creating the visit.
- Use separate enter/exit radii (hysteresis) to avoid rapid bouncing at the boundary.
- When nearby jobs overlap, request installer selection.
- Preserve raw points and the algorithm/version that produced the visit.
- Permit employee correction requests and owner/admin final edits.
- Mark visits derived across tracking gaps as lower confidence.

Radius, sampling cadence, departure rule, battery impact, multiple-installer credit, early/unassigned visits, and overnight behavior require field calibration before claiming automatic accuracy.

### Route visibility and retention

- Installer sees their own current and historical route plus assignments.
- Managers/admins see all current and historical installer routes.
- Other employees may see appropriate team status, not detailed historical trails.
- Detailed/raw route history is retained 120 days, as confirmed for the season.
- Proposed: summarized approved job arrival/departure/time records remain indefinitely as operational/time records; this distinction needs owner confirmation.
- Tracking occurs only while clocked in/Route Mode is active and stops at clock-out.

## 19. Installer completion workflow

An installer can:

- View assigned job details permitted by role
- See route/order and job status
- Record/confirm arrival and departure
- Upload completion photographs; whether they are required, how many, and whether requirements vary by job remains to be defined
- Mark operational work complete
- Add completion notes/issues

The Quote Tool is canonical for job operational status. Operations Hub or Telegram sends an idempotent field-completion command; the Quote Tool validates/stores a nonfinancial state such as `field_work_completed` or `completion_submitted_for_office_review` and publishes the resulting event back. This must not automatically complete invoices or financial workflows. If the Quote Tool already has Telegram completion/material-actual behavior, Operations Hub must call the same canonical operation/API rather than create a conflicting completion path.

Completion photos should be stored once and referenced by both systems where practical. The authoritative storage location and design/job attachment rules must be part of the integration contract.

Recommended ownership is the Quote Tool's existing job/design photo system. Operations Hub stores the returned photo/reference ID and obtains authorized signed access instead of copying the same completion image into two storage systems.

## 20. Quote Tool integration contract

### Proposed ownership

| Data | Authoritative system |
| --- | --- |
| Customer/contact | Quote Tool |
| Job and job address | Quote Tool |
| Schedule and assignment | Quote Tool |
| Budgeted installation hours | Quote Tool |
| Employee identity/department/role | Operations Hub |
| Attendance and breaks | Operations Hub |
| Raw route and calculated visits | Operations Hub |
| Arrival/departure and actual job time | Operations Hub, synchronized to Quote Tool |
| Job operational/field-completion status and completion-photo binary | Quote Tool; Operations Hub/Telegram send an idempotent command and receive the resulting event/reference |
| Financial/invoice completion | Quote Tool only; not triggered implicitly |

### Required integration properties

- Stable shared job and employee IDs
- Field-by-field ownership and status mapping
- Versioned API/event contracts
- Authenticated service APIs rather than direct cross-project service-role database writes
- TLS plus scoped environment-specific machine credentials, replay protection (signed timestamp/nonce or equivalent), key rotation, request-size limits, and separation from browser-session credentials
- Idempotency keys for every mutation
- Durable transactional outbox/inbox delivery records with source, aggregate version, expected prior version, actor, channel, correlation/causation IDs, and retry/dead-letter state
- Source and actor attribution
- Retry with exponential backoff
- Dead-letter/sync-failure queue
- Conflict resolution and loop prevention
- Archive/deletion rules
- Reconciliation jobs and health dashboard
- Test/sandbox environment
- Audit correlation ID visible in both systems

“Bidirectional” means each owner publishes relevant changes and accepts authorized commands. It does not mean last-write-wins across both databases.

## 21. Telegram integration

Telegram can provide notifications and selected actions.

### Candidate notifications

- New/changed installer assignment
- Schedule change
- Upload failure
- GPS review requirement
- Missed/open clock-out
- Route/visit exception
- Hotspot/avoid suggestion activity
- Integration failure visible to admins

### Candidate audited actions

- Confirm/view assignment
- Select an ambiguous job visit
- Submit or confirm operational completion
- Attach completion photos where supported
- Acknowledge an exception

### Safeguards

- Explicit Telegram-user-to-employee linking
- Keep the current Quote Tool Telegram webhook ingress initially unless a deliberate bot cutover is planned; one Telegram bot can have only one active webhook destination.
- Same permissions as the PWA
- Telegram calls the same canonical service operations as the PWA rather than implementing a second set of business rules.
- Confirmation before consequential writes
- Deduplicate Telegram `update_id` and every business command; use reply-bound/inline action IDs rather than an unscoped bare “yes” for consequential writes.
- Source channel stored as `telegram`
- No customer address or route disclosure in unauthorized groups
- Clear error when Telegram action succeeds locally but downstream sync fails
- Service identity uses minimum necessary database/API privileges
- Verified advertising placements can only originate from PWA Camera Mode; Telegram photos do not contain trustworthy concurrent GPS and cannot count as verified placements.

## 22. Reporting, leaderboards, and exports

### Internal visibility

Leaderboards are available to authenticated YLL employees. Sensitive addresses and route details are excluded.

### Advertising metrics

- Total accepted placements
- Verified vs flagged/review placements
- Placement Run duration
- Placements/hour including travel
- Placements by campaign, employee, date, town/area
- Optional unique placement spots
- Hotspot coverage/performance later

### Installation metrics

- Jobs completed YTD, employee and team
- Actual time per job
- Budgeted vs actual hours
- Arrival/departure confidence and exception rate
- Completion photo/status completion
- Team/individual totals with fair multi-installer credit rules

### Office metrics

- Preserve existing call and coaching metrics
- Attendance/hours worked
- Existing office/team performance behavior

### Export

- CSV and Excel exports for authorized users
- Filters by date, employee, department, campaign/job, status, and GPS verification
- Export events are audited
- Route/customer exports are restricted
- Version one time exports are raw/operational, not marketed as payroll-ready

Corrections, voids, GPS approvals, and time edits must recalculate affected reports and leaderboards.

## 23. Admin and manager operational screens

Required operational surfaces include:

- Employee provisioning, phone, department, role, status, and session management
- Campaign creation, assignment, archive, and sequence health
- Active, forgotten, auto-closed, and voided Placement Runs
- Placement feed/map and GPS review queue
- Failed/offline upload monitoring
- Hotspot and avoid-area moderation
- Current/open shifts and time exceptions
- Time correction requests and approval history
- Route and job-visit review
- Completion exceptions
- Quote Tool and Telegram synchronization failures
- Export center
- Audit log
- Integration/system health

## 24. Proposed data model

Exact migrations will follow codebase inspection, but the logical model should include:

### Identity and authorization

- `organizations`
- `employees`
- `employee_auth_identities`
- `employee_sessions` or provider-session references
- `roles` / permission policies
- `departments`
- `audit_events`

### Advertising

- `campaigns`
- `campaign_assignments`
- `campaign_sequences`
- `placement_runs`
- `placements`
- `placement_media`
- `placement_reviews`
- `hotspots`
- `hotspot_revisions`

### Attendance/installations

- `shifts`
- `breaks`
- `time_correction_requests`
- `route_sessions`
- `route_points` (120-day raw retention)
- `job_visits`
- `job_visit_revisions`
- `job_completion_records`
- `job_completion_media` (reference/metadata pointing to canonical Quote Tool photo IDs and access state, not a second binary copy)

### Integration/operations

- `external_id_mappings`
- `integration_events`
- `integration_deliveries`
- `dead_letter_events`
- `notification_deliveries`
- `telegram_identity_links`

Every mutable operational table should include organization, creator/source, created/updated timestamps, soft-delete state where appropriate, and optimistic version/revision information.

Spatial records should use a defined geospatial representation, preferably PostGIS `geography` with SRID 4326 and GiST indexes. Placements, hotspot points/segments/areas, route points, and job coordinates must use meter-based distance calculations rather than ad hoc degree math.

## 25. Security, privacy, and audit

- Implement and test Supabase row-level security before field launch.
- Never expose service-role credentials to the browser.
- Use server-side authorization for every mutation; hiding a button is not authorization.
- Separate original/stamped media access with signed URLs and role checks.
- Encrypt in transit and use provider encryption at rest.
- Audit actor, source channel (`pwa`, `telegram`, `sync`, `system`), action, target, before/after, device/session, reason, and correlation ID.
- Consequential time/status/Telegram/integration writes atomically persist their authoritative audit and outbox records with the business change. Best-effort logging is supplemental only; if required audit persistence fails, the write fails or remains recoverably pending.
- Show an employee-facing notice describing GPS collection, purpose, access, and 120-day raw-route retention.
- Track only during active authorized workflows.
- Restrict and audit exports.
- Define backup/restore and media lifecycle monitoring.
- Consider incidental faces, license plates, and private-property imagery in policy/training; automated blurring can be a later enhancement.
- Rate-limit OTP, capture creation, uploads, Telegram commands, and admin mutation APIs.
- Do not send OTPs, coordinates, phone numbers, customer addresses, private photo URLs, or detailed routes to ordinary logs, analytics, or session replay.
- Validate media type, size, dimensions, checksum, and server-side re-encoding before publishing derived images.
- Audit every current public route before production: require authenticated/platform-secret cron requests, make webhooks fail closed when secrets are absent, validate required production environment variables at deploy/startup, prefer headers/HMAC over query-string secrets where migrations permit, and test every logged-out exception.
- Restrict Telegram roster/pairing, chat routing, webhook configuration, and write enablement to Naldo/Jason-authorized capabilities with audit history.

## 25A. Repository, domain, and deployment migration

Perform the approved rename as a staged cutover rather than changing every identifier simultaneously:

1. Add Operations Hub branding and role-based feature flags while preserving the current deployment.
2. Add `ops.yulelovelights.com`, HTTPS, Supabase Site URL/redirect allowlists, PWA manifest/start URL, and service-worker scope.
3. Rename GitHub `yll-call-copilot` to `yll-operations-hub`.
4. Update local remotes, Vercel Git linkage, CI/deploy hooks, package metadata, documentation, and Quote Tool links.
5. Inventory and update GHL, Twilio, Deepgram, cron, webhook, and callback URLs that reference the old deployment.
6. Keep the old deployment alias during cutover; run authentication, webhook, cron, call-workflow, and PWA smoke tests before removal.

Use repeatable version-controlled migrations, staging, schema-drift checks, backups, and rollback instructions. The auth conversion should use expand/backfill/verify/contract steps so existing office accounts are not stranded.

## 26. PWA and device validation matrix

Primary devices are iPhones, with Android also supported. Before launch, validate at minimum:

- Current and one prior major iOS/Safari version
- Current Android Chrome
- Home-screen installation and standalone launch
- Camera/location permission first-use, granted, denied, revoked, and reset states
- Reopen active run directly to Camera Mode
- Lock/unlock, app switching, process kill, and phone restart
- Camera front/back/flash behavior
- GPS acquisition at open intersections, near trees/buildings, and weak-signal locations
- Offline capture and 10/50/100-image queues
- Compact queued item count and queued data size
- Low storage and storage eviction
- Weak/transitioning cellular/Wi-Fi
- Duplicate retry/idempotency
- Failed upload recovery
- Undo while online/offline
- Forgotten-run reconciliation using the owner-approved trigger (proposed: midnight)
- Battery and cellular-data impact
- Limit high-accuracy advertising GPS to visible Camera Mode/capture windows; the Placement Run timer itself requires no continuous GPS.
- Upload the original once, generate thumbnails/stamped variants server-side, and limit concurrent uploads.
- Reduce/pause nonessential upload work at critically low battery while preserving capture.
- Installer foreground-route gaps
- Accessibility: large touch targets, contrast, VoiceOver/TalkBack labels, one-handed use, and motion/haptic alternatives

## 27. Delivery sequence

### Phase 0 — Foundation and migration safety

- Rename plan for repository/product/domain without breaking deploys
- Canonical employee model and existing-office-user migration
- Phone OTP provisioning and recovery
- Role/department permission matrix and RLS
- Unified audit framework
- Integration contract and shared IDs with Quote Tool
- Independent production kill switches and rollback behavior for placement writes, Route Mode, Quote Tool sync writes, and Telegram writes
- Mobile PWA shell and device test harness
- Regression suite for existing Call Copilot features

### Phase 1 — Advertising field release

- Campaigns/assignments/sequences
- Placement Run state machine
- Persistent Camera Mode
- GPS policy/review
- Offline queue and failed uploads
- Original/stamped photos
- Placement feed/map
- Hotspots/avoid suggestions
- Placement reporting/leaderboard/export
- Admin operational queues

### Phase 2 — Attendance and installation operations

- Clock in/out and optional breaks
- Time exceptions and Naldo/Jason approvals
- Quote Tool assigned-job read model
- Foreground Route Mode and gap detection
- Evidence-backed five-minute visit suggestions/automatic confirmation only when sufficient foreground data exists, plus ambiguous/manual fallback
- Completion photos and operational completion
- Budget-vs-actual/job-time reporting
- 120-day raw route retention

### Phase 3 — Telegram and operational hardening

- Telegram identity linking
- Notifications and selected audited actions
- Full sync health/dead-letter/reconciliation tooling
- Field calibration and performance tuning
- Additional push notifications

### Later, only if justified

- Lightweight native wrapper for dependable background routing
- Data-driven hotspot scoring from leads/quotes/sales
- Suggested/closest placement routes
- Advanced inventory attribution
- Payroll/overtime/rounding/pay-period workflows
- Automated privacy blurring

## 28. Launch acceptance criteria

### Advertising

- An assigned advertising employee can start a run and reach Camera Mode in one tap after initial setup.
- Reopening during an active run returns directly to Camera Mode.
- The next shutter is usable without waiting for prior upload/address/stamping.
- Every accepted placement has required capture/GPS/audit metadata.
- Under supported storage conditions and absent OS/app-data eviction, offline captures survive normal close/restart; server placement creation remains idempotent/exactly-once even when upload delivery retries.
- Campaign Sign Numbers are unique and never reused.
- X ends the run; forgotten runs reconcile to the last capture using the approved trigger (proposed: local midnight).
- Employees can undo their last placement for five minutes.
- Maps distinguish recent, historical, suggested, and avoid data.

### Time/installations

- Office employees, installers, and managers can clock in/out; clock-in has required GPS and clock-out follows the owner-approved location rule.
- Optional breaks work without blocking clock-out.
- Only Naldo/Jason can finalize edits/approvals.
- Installer receives Quote Tool assignments and can submit operational completion photos/status.
- Visits require sufficient foreground evidence or installer confirmation, preserve confidence/gaps, and allow ambiguity correction.
- Tracking stops at clock-out and raw route data expires after 120 days.
- Financial completion is never triggered implicitly.

### Security/operations

- Phone OTP is restricted to provisioned active employees.
- RLS/authorization tests prove each role cannot access prohibited records.
- All mutation channels create consistent audit events.
- Sync retries do not duplicate jobs, visits, completions, placements, or photos.
- Admins can see and resolve upload, GPS, time, route, and sync exceptions.
- Existing Call Copilot workflows pass regression tests.
- Camera controls meet mobile accessibility acceptance: at least 44×44-point targets, accessible names for X/flash/camera/retry, non-color-only states, VoiceOver/TalkBack capture announcements, text scaling, high-contrast overlays, and haptic/sound/visual confirmation options.

### Adversarial/system tests

- Missing production Supabase configuration denies access.
- Every role/department/data-visibility combination is tested server-side and through storage policies.
- Terminated user, recycled phone number, lost phone, OTP abuse, and revoked session cases fail safely.
- Two offline phones capture in the same campaign without duplicate Sign Numbers.
- At least 50 offline images survive normal app termination/restart when OS storage is retained and synchronize to exactly one server placement each.
- GPS denied, missing, stale, approximate, drifting, and above-threshold readings produce the documented states.
- Quote Tool remains unavailable for hours, then queued events replay idempotently and out-of-order old versions are rejected.
- Duplicate Telegram delivery, double confirmation, expired confirmation, and failed downstream sync do not duplicate actions.
- Field completion never invokes financial completion.
- iPhone PWA suspension produces an explicit route gap/review state rather than fabricated continuous time.
- Raw route points expire after 120 days while approved visit/time summaries follow the owner-approved retention policy (proposed: indefinite).
- Old/new domain aliases, webhooks, cron, and rollback paths work during repository rename.

## 29. Known gaps and decisions to validate before implementation sign-off

These are not hidden assumptions:

1. Door-hanger location terminology/privacy must be reconciled with the “never a house” yard-sign clarification.
2. Decide who approves more-than-20-meter placement submissions and whether they count before approval.
3. Field-test the GPS retry duration and freshness window; proposed starting point is 10 seconds.
4. Confirm midnight in the configured YLL timezone is the forgotten-run reconciliation event.
5. Confirm server-assigned offline Sign Numbers are acceptable even when final number order differs from capture order.
6. Define exact time-exception rules for forgotten clock-out, open break, active visit, overnight, and approved-period locking.
7. Calibrate installer enter/exit radius, sampling interval, multi-installer credit, and tracking-gap behavior.
8. Finalize operational-completion semantics against the existing Quote Tool/Telegram flow.
9. Define the exact launch list of Telegram actions and group privacy rules.
10. Validate storage budget, backups, and indefinite photo retention cost.
11. Define whether/when coworker current location is visible beyond managers.
12. Define unique-placement-spot clustering before displaying that metric.
13. Define no-GPS behavior for time punches, offline punches, and desktop office punches.
14. Decide whether installer completion photos require live camera/GPS or may use gallery recovery.
15. Define the forgotten daily clock-out rule and employee reminder cadence.
16. Select/configure the production SMS/OTP provider and recovery/support process.
17. Write the versioned Quote Tool `INTEGRATION-CONTRACT.md` before enabling cross-system writes.
18. Confirm that starting a new Placement Run requires connectivity while an already-active run can continue/end offline; define cached-session grace and deactivated-offline-upload quarantine behavior.
19. Define whether managers merely filter departments, select a working department when clocking in, or allocate their time across departments.
20. Define advertising placement/photo visibility: all placements in assigned campaigns vs own only, other employees' notes, exact coordinates/stamped images, and historical cross-campaign access.
21. Confirm the forgotten-run anchor as the last locally persisted shutter capture and approve the midnight/zero-photo reconciliation proposal.
22. Define supported offline queue limits and the user policy for pending uploads before uninstall, browser-data clearing, account switching, or device replacement.

## 30. Review findings already incorporated

Independent plan review identified and this document now addresses:

- Forgotten-run reconciliation timing
- Offline Sign Number collisions
- GPS review ownership and leaderboard treatment
- PWA/offline/device validation
- Browser background-route limitations
- Time exception and approval workflow
- Quote Tool field ownership, idempotency, loop prevention, and financial-completion boundary
- Existing-auth migration to phone OTP
- Admin exception and health screens
- Privacy/retention/export boundaries
- Exact metric definitions and historical-placement labeling
- Hotspot provenance/moderation/safety
- Telegram identity, permissions, confirmation, idempotency, and audit

## 31. Future Claude-plan merge protocol

When Claude's plan becomes available:

1. Place or reference it in this same `docs/operations-hub/` planning area.
2. Do not edit either original plan during the first comparison pass.
3. Build a decision matrix with columns: topic, Codex decision, Claude decision, conflict, recommended master decision, owner approval required.
4. Separate factual implementation differences from product-choice differences.
5. Inspect the current code and migrations before accepting either plan's assumptions.
6. Create `MASTER-PLAN.md` only after contradictions are resolved.
7. Keep a decision log linking every master decision to its source and approval.
8. Once approved, make `MASTER-PLAN.md` authoritative and mark both source plans historical/read-only.

The master plan should preserve the Quote Tool and existing office capabilities as working systems while unifying identity, permissions, operational events, and user experience intentionally—not through uncontrolled database coupling.

## 32. Research and platform references

- [SimpleCrew](https://www.simplecrew.com/)
- [Track Every Yard Sign](https://trackeveryyardsign.com/)
- [W3C Geolocation](https://www.w3.org/TR/geolocation/)
- [W3C Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/)
- [W3C HTML Media Capture](https://www.w3.org/TR/html-media-capture/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram Mini Apps](https://core.telegram.org/bots/webapps)
- [Meta WhatsApp Business message objects](https://www.postman.com/meta/whatsapp-business-platform/folder/1dtuocp/messages-object)
