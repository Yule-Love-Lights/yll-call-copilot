# Yule Love Lights Operations Hub — product specification

Status: **owner-approved Hub behavior; implementation incomplete**
Version: `1.3-review-1`
Approved: 2026-08-07
Last reconciled: 2026-08-20

This file is the normative Hub-side behavior specification. Cross-repository
fields, commands, events, time, pay, and Quote Tool behavior are authoritative
only after they exist in the merged canonical Quote Tool contract.

## 1. Product shell

- The existing YLL Call Copilot repository SHALL be renamed in stages to Yule
  Love Lights Operations Hub and served at `ops.yulelovelights.com`.
- Existing office/call functionality SHALL remain available during the rename.
- The primary supported field experience SHALL be an installed PWA on iPhone
  and Android. Browser limitations SHALL be stated honestly.
- The Hub SHALL use role/department-aware home screens and SHALL route a
  non-owner Advertising employee with an active Placement Run directly to
  Camera Mode on every reopen.
- The Hub SHALL expose exactly four UI modes: Management, Office, Advertising,
  and Installer. Management SHALL remain an owner/admin view, not a department
  membership or paid-work context.
- Naldo and Jason SHALL always land in Management after sign-in or reopen.
  Department detail SHALL open as a Management drilldown with an explicit
  return to Management; it SHALL NOT impersonate an employee or change paid
  context.
- Every other employee SHALL have an explicit primary home mode. The Hub SHALL
  NOT use the last-viewed mode as the next sign-in default. A mode switcher
  SHALL appear only when the employee has multiple active department
  memberships.
- Outside a paid day, the switcher SHALL change view only. During paid work, a
  department change SHALL use the canonical Quote Tool context switch and fail
  closed if that operation is unavailable. Hub SHALL reject with review during
  an active Placement Run or open Installer job segment; that final owner rule
  requires a canonical P16.2 amendment before it becomes cross-repository
  contract authority. Open-break final policy remains unresolved, so the
  current canonical safe default SHALL continue to reject with review.

## 2. Authentication and authorization

- Authentication SHALL remain invite-only email/password while Decision 25 is
  active. Phone OTP, Twilio Verify, Turnstile, recovery/reassignment, and
  password-identity revocation SHALL remain disabled until a later owner
  activation decision and their independent gates pass.
- Naldo and Jason SHALL be the only provisioned owner/admin identities in V1.
- Roles SHALL include owner/admin, Office, Advertising, and Installer. A Manager
  permission tier SHALL exist in design/tests but SHALL have no V1 assignee.
- Employees MAY hold multiple department memberships. A paid shift SHALL have
  exactly one active department-context interval at every instant.
- Active-context changes SHALL be explicit, version checked, audited, and
  accepted by the Quote Tool. They SHALL NOT retroactively reclassify prior
  time.
- Membership union MAY expose non-sensitive module navigation. It SHALL NOT
  union sensitive permissions. Every department-scoped sensitive request SHALL
  verify the active employee, current membership version, explicit capability,
  paid-work context, and assignment/resource scope on the server.
- A secondary Office membership SHALL NOT bypass the installer clock gate.
  Office job work SHALL use a distinct `office_job_operations` capability and
  resource-scoped server operation while the employee is clocked in under the
  Office context. A multi-department employee SHALL switch context before doing
  work for another department.
- Owner/Admin capabilities SHALL be provisioned only to Naldo and Jason and
  sensitive reads SHALL be audited. Every Manager claim SHALL be denied in V1.
- Every membership snapshot/change SHALL carry a monotonic
  `membership_version`, effective time, and explicit active/revoked state. Hub
  SHALL publish the full authoritative snapshot; Quote Tool SHALL fail closed
  on missing, stale, out-of-order, or deactivated state and invalidate affected
  offline/cache grants.
- Authorization SHALL be enforced server-side and with RLS or equivalent
  per-table policy. Hiding UI alone SHALL never count as authorization.
- `Public` SHALL mean active YLL employees only. Internal-public data SHALL
  exclude pay amounts, customer contacts, exact private routes, and restricted
  residential locations.

## 3. Source-of-truth rules

| Fact | Canonical owner |
|---|---|
| Hub identity, role, membership, active state | Hub |
| Campaign, Placement Run, placement, capture media, hotspot/avoid | Hub |
| Sign inventory and weekly allocation ledger | Hub |
| Raw route/device evidence | Hub |
| Customer, quote, job, address, schedule, assignment | Quote Tool |
| Budgeted labor, crew role, job notes/design/load list | Quote Tool |
| Day clock, break, job segment, travel, approval, lock, adjustment | Quote Tool |
| Operational completion and completion media reference | Quote Tool |
| Compensation, quality state, earnings, payroll/export | Quote Tool |

- Cross-app writes SHALL use the accepted canonical contract.
- Hub SHALL NOT calculate pay, invent canonical time, or treat a local command
  as accepted before Quote Tool acknowledgment.
- Hub read models SHALL retain canonical source version and source-through time.

## 4. Department home behavior

### Office

The home SHALL show Clock In/Out, Break when policy requires it, personal call
statistics, current office work, and the existing call/coaching tools. It SHALL
not expose advertising or installer actions without a matching membership and
active context. Exact customer/job information SHALL remain unavailable until
an accepted Office Clock In and a resource-scoped office capability both exist.

### Advertising

The home SHALL prioritize assigned campaigns and one **Start Work & Placement
Run** control. It SHALL show current run/clock state, pending uploads, inventory
allocation, accepted/review counts, personal placement rate, map/hotspots, and
an explicit End Run/Clock Out path.

### Installer

The pre-clock home SHALL show non-sensitive schedule summary. After an accepted
clock-in it SHALL show exact route, jobs, crew, design/load list, job notes,
arrival/departure actions, completion draft/actions, and personal metrics.

### Management

The home SHALL show all three employee departments, open identity/time/
placement/completion/command exceptions, inventory-reconciliation exception
counts, current operations, digest health, contract/deploy versions, and
payroll-readiness summaries supplied by the Quote Tool. Sign-inventory stock,
allocation, and item detail SHALL live inside the Advertising drilldown, not on
the Management home.

## 5. Canonical day clock capture

- Office, Advertising, Installer, and any future Manager employee SHALL have a
  canonical Quote Tool day clock when working.
- Clock In SHALL include active department, device time/timezone, requested
  effective time, source, location evidence when available/required, and a
  semantic idempotency key.
- Clock Out SHALL include the same envelope and SHALL close open state at the
  accepted effective time. Open break, visit, or Placement Run SHALL create a
  visible review flag.
- Break behavior SHALL be policy-driven by Quote Tool configuration. A break
  SHALL pause job allocation and route collection; ending a break SHALL resume
  the day, not silently reopen a job.
- Manual punches SHALL be primary for pay in V1. GPS SHALL be evidence and MAY
  generate suggestions only.
- User-facing command states SHALL include Saved on device, Waiting to sync,
  Submitted, Accepted, Needs review, and Rejected.
- Midnight local-time auto-close SHALL be a review backstop. It SHALL preserve
  requested/device/receipt/effective times and SHALL never hide the correction.
- Employees SHALL request corrections; only Naldo/Jason SHALL approve canonical
  changes. Every accepted correction SHALL be append-only.
- Employees SHALL see every correction request's submitted, under-review,
  accepted, partially accepted, rejected, or forward-adjusted state, safe
  reason, chosen effective time, and resulting adjustment reference.

## 6. Placement Run state machine

### Start

1. Employee selects an assigned campaign if more than one eligible campaign is
   shown. A run SHALL remain on one campaign and one unit type.
2. If not clocked in, the primary start action SHALL request Quote Tool Clock In
   and Hub Start Run as an orchestrated operation.
3. Camera Mode SHALL open only with a durable run record and a clear clock
   result. Partial failure SHALL show which side succeeded and one safe recovery
   action; retries SHALL not duplicate a clock or run.
4. A new run SHALL require connectivity. An already accepted run MAY continue
   and end offline.

### Active

- Reopening the installed PWA SHALL route directly to Camera Mode.
- Campaign switching SHALL not occur inside a run.
- Camera, flash, camera flip, queue, map guidance, settings, and End Run SHALL be
  accessible without leaving the working screen.
- The UI SHALL not force the employee back through dashboard navigation between
  captures.

### End

- X SHALL mean End Placement Run, not generic navigation and not automatic day
  Clock Out.
- End SHALL be immediate locally, synchronize idempotently, return Home, and
  provide a short Undo.
- After End, the Hub SHALL offer Clock Out if the day remains open.
- Clocking out with an open run SHALL close the run at the last durable shutter,
  attach an end-of-day review note, and never count time after that shutter as
  placement-run productivity.
- A forgotten run SHALL reconcile at local midnight to the last durable shutter.
  A zero-photo run SHALL become abandoned/needs review.
- Run rates SHALL disclose the denominator: explicit run uses start-to-X;
  reconciled run uses start-to-last-durable-shutter.

## 7. Camera capture and local durability

### Shutter requirements

- Verified placement SHALL require live-camera provenance.
- One shutter SHALL persist the original photo and metadata in durable local
  storage before Camera Mode resets. Network upload, reverse geocoding,
  stamping, numbering, and server review SHALL not block the next shutter.
- Notes SHALL be optional and nonblocking.
- The camera SHALL not auto-capture. The user takes one deliberate shutter per
  placement.
- Gallery import SHALL be disabled for ordinary verified placement. If an owner
  enables exception import later, it SHALL be labeled unverified and SHALL not
  enter accepted pay count without explicit review.

### Required evidence

Every local capture SHALL include:

- Hub employee, campaign, run, unit type, and client sequence;
- capture time, timezone, and server receipt time when submitted;
- latitude/longitude, reported horizontal accuracy, GPS sample time, and time
  delta between sample and shutter;
- camera/gallery provenance, device installation identifier, command ID,
  semantic idempotency key, and media checksum;
- optional note and any owner-approved review reason;
- server-derived address and permanent campaign Sign Number after acceptance.

### GPS policy

- Product target: 1–5 m when device and conditions permit. It SHALL NOT claim
  guaranteed 1–3 m accuracy.
- Display bands: 0–5 m excellent; >5–10 m good; >10–20 m accepted/labeled;
  >20 m review; missing fix unverified.
- A missing/weak fix MAY be replaced only by a same-camera, stationary,
  short-grace sample with the time delta recorded. Later unrelated GPS SHALL
  never be attached.
- A locally durable photo without required GPS MAY wait for review/sync but SHALL
  not become an accepted verified placement automatically.
- Naldo/Jason SHALL resolve poor/no-GPS exceptions.

### Server acceptance

- Campaign Sign Numbers SHALL start at 1, allocate atomically in server-
  acceptance order, never change, and never be reused.
- Server SHALL retain the original and generate stamped derivative/thumbnail.
  Stamp SHALL contain capture date/time, derived address, GPS accuracy, and
  Sign Number.
- Feed sorting SHALL use capture time while displaying receipt/sync delay when
  relevant. Offline cards SHALL say `Number pending`.
- Media, placement, number, derivative jobs, audit, inventory effect, and outbox
  SHALL be atomic or recoverable with reconciliation.

## 8. Placement lifecycle, review, and corrections

Lifecycle SHALL be:

`captured_local -> queued -> submitted -> under_review -> accepted | rejected | voided`

An accepted placement MAY later receive an append-only `reversed` event.

- Each transition SHALL have stable event ID, command ID, actor/source, event
  time, effective time, entity version, reason code, and correlation ID.
- Employee MAY undo only their latest placement for five minutes. Undo creates a
  void and permanent number gap.
- Blur SHALL not be a rejection by itself because location is the core evidence.
- Rejection/reversal reason, evidence, reviewer, and effective pay week SHALL be
  auditable and visible to the affected employee in appropriate language.
- Correction requests SHALL exist for wrong campaign/unit, time, location,
  inventory link, attribution, or note. Employees SHALL not overwrite accepted
  canonical records.
- Quote Tool SHALL acknowledge accepted/reversed placement events used by pay.
  Unacknowledged events SHALL block Advertising Week Close and payroll readiness.
- A placement SHALL enter piece pay only when Quote Tool validates its linked
  paid-day envelope, capture-time Advertising context interval, membership
  version, earning date, and pay-enabled unit. Quote Tool SHALL snapshot the
  effective rate/config version; reversal or correction SHALL reference and
  adjust that original snapshot rather than reprice it.

## 9. Placement privacy and maps

- Yard-sign records SHALL be modeled as placement spots such as busy roads,
  intersections, traffic stops, poles, and appropriate grass/public areas—not
  customer houses.
- Hotspots and avoid areas MAY be suggested by employees and appear immediately
  as Suggested. Naldo/Jason SHALL approve canonical guidance.
- Assigned advertising employees SHALL see their assignments, their own
  placements, approved historical campaign coverage summaries, and approved
  hotspot/avoid guidance. Those summaries SHALL exclude another employee's
  exact point, photo, note, and placement history.
- Exact employee route trails SHALL be visible only to the employee and
  Naldo/Jason unless Naldo approves a narrower operational need.
- Active employees MAY see team totals, approved campaign coverage, hotspots,
  and avoid zones. Another employee's exact coordinates, placement photos,
  notes, history, and route trail SHALL remain hidden. Naldo/Jason MAY see all
  exact placement evidence and route history.
- Before verification, the capturing employee MAY see exact door-hanger
  evidence only while it is local/pending/under review or inside its correction
  window. After verification, residential points SHALL be Naldo/Jason-only;
  employee maps SHALL aggregate/round them. Broader visibility requires an
  explicit ruling.
- No sign-retrieval workflow is required in V1.

## 10. Sign inventory

- Physical inventory SHALL use an append-only Hub ledger separate from Sign
  Number.
- Event types SHALL include receive/restock, issue allocation, transfer, place,
  return, damage/loss observation, and correction.
- Weekly allocations SHALL record item/SKU, quantity, issuer, recipient, time,
  and effective week.
- Accepted sign placement SHALL consume one compatible allocated unit exactly
  once. Reversal SHALL create a compensating inventory event according to the
  reviewed physical outcome; it SHALL not rewrite history.
- Expected back SHALL equal issued plus transferred-in minus transferred-out
  minus accepted sign placements. Returned, approved damage/loss observations,
  and variance SHALL remain distinct fields. Variance SHALL be reviewed and MAY
  trigger restock.
- Inventory variance SHALL never become an automatic wage deduction.
- Advertising Week Close SHALL include inventory reconciliation and the
  acknowledged accepted-placement count sent to Quote Tool.

## 11. Installer schedule and job-time flow

- Before accepted Clock In, Quote Tool SHALL return only date, start window,
  crew, and preparation summary. Exact address/contact/route/job actions SHALL
  be denied server-side.
- Audited owner emergency override and a time-limited signed offline packet are
  the only exceptions.
- Offline sensitive job data SHALL remain disabled until the signed-packet
  lifetime, device binding, encryption, snapshot versioning, expiry, logout,
  context-switch, deactivation, and next-open purge rules in the contract are
  configured and tested. Non-sensitive schedule summaries remain available.
- After Clock In, Hub SHALL show same-day assignments, route/order, job notes,
  design/load list, budgeted elapsed hours, planned crew size, budgeted crew
  hours, job lead, and assigned crew roles when provided.
- Arrived SHALL open a canonical job segment. Departed SHALL close it. Manual
  actions are pay-authoritative in V1.
- Route GPS MAY flag discrepancies or suggest a visit after calibration. A
  five-minute dwell is evidence, not automatic time. The employee or owner must
  confirm it.
- Travel SHALL be explicitly represented by canonical operations or visible as
  an unclassified residual. Hub SHALL never independently calculate pay travel.
- Open-segment, missed-tap, missing-GPS, duplicate, overlap, overnight, DST,
  break, and correction conditions SHALL enter a visible exception flow.

## 12. Installer completion

- Canonical completion SHALL have separate `field_work_state` and
  `completion_review_state` dimensions.
- Field completion SHALL never mark invoices paid, financially complete a job,
  or otherwise mutate money.
- Hub and Telegram SHALL invoke the same idempotent Quote Tool completion
  operation.
- Completion payload SHALL support materials used (SKU, quantity, estimated
  quantity), optional on-hand true-up, note, photo references, and raw text for
  audit.
- Completion media SHALL be optional and SHALL never block the completion
  command. The surface SHALL prompt at most three times, then allow completion
  without media. Camera/gallery provenance, GPS requirements, and the exact
  installed-notification trigger remain open.
- When the employee attaches optional media, offline completion SHALL keep the
  media in a durable Hub draft until its upload state and the Quote Tool command
  are acknowledged. UI SHALL not say canonically accepted before that response.
- On the approved installed state, Quote Tool MAY emit seller attribution and
  review/referral enqueue events. Hub SHALL notify only from those canonical
  events.

## 13. Statistics and employee transparency

- Every statistic SHALL state period, source-through time, source system,
  numerator, denominator, exclusions, provisional status, and adjustments.
- Advertising MAY show: captured/submitted/accepted/review/rejected/reversed,
  accepted placements per run hour, accepted placements per day-clock hour,
  campaign/spot coverage, and inventory reconciliation.
- Installer MAY show: jobs completed, budgeted versus actual crew hours, travel,
  exception/correction status, time per job, quality status, and personal trend.
- Office MAY show: qualified calls, outcomes, coaching scores, response time,
  personal trends, and source-through status once formulas are canonical.
- Internal leaderboards SHALL use approved operational facts only. They SHALL
  never expose pay amounts, provisional money, customer details, exact routes,
  or restricted residential locations.

## 14. Pay display and payroll boundary

- Hub SHALL render only Quote Tool-supplied pay values/states.
- Installer provisional performance pay SHALL display exactly `Pending quality
  review` with close date everywhere: UI, Telegram, digest, notification, and
  export preview.
- Provisional values SHALL not enter earned totals, leaderboards, or payroll
  export. Only earned values may be exported.
- A forfeiture SHALL mean a value never became earned and SHALL never appear as
  a wage deduction. Evidence, reason, and employee response state are required.
- Advertising pay SHALL be calculated Quote Tool-side from acknowledged
  accepted placements and canonical hours. Initial configured terms are $2.50
  per accepted placement with a $17/hour floor true-up; configuration is
  effective-dated.
- Hub SHALL show payroll blockers/readiness supplied by Quote Tool and SHALL not
  manufacture a second payroll close.
- V1 payroll output SHALL be raw CSV from Quote Tool. QuickBooks integration is
  deferred.

## 15. Telegram

- Quote Tool SHALL retain the one Telegram webhook and bot identity.
- Telegram pairing, routing, webhooks, and write enablement SHALL be Naldo/Jason
  only and audited.
- Consequential actions SHALL call the same canonical operations as Hub. Update
  ID and semantic idempotency SHALL prevent duplicates across re-taps/retries.
- Bot SHALL send an interim processing response within two seconds and a final
  Accepted/Needs review/Rejected response when canonical processing finishes.
- Advertising V1 SHALL provide status and a Camera Mode deep link. Telegram
  photos SHALL not be accepted as verified placement.

## 16. Digests

- Hub SHALL compose four separate digests: Office, Advertising, Install, and
  Management.
- The Office, Advertising, and Install digest types SHALL combine their
  department's attendance and operational facts. Management SHALL combine
  authorized cross-department owner/admin facts without becoming a department
  or paid-work context. Naldo and Jason SHALL receive all four.
- "Per-department recipients" remains an owner configuration decision. Until
  that rule is approved, the Hub SHALL NOT infer that every active department
  member receives a department-wide digest.
- Quote Tool SHALL supply canonical time/pay/job facts; Hub SHALL supply
  campaign/placement/inventory and Hub-owned call facts.
- Each digest run SHALL record type, period, source-through times, input
  versions, recipients, delivery state, retry state, and correlation ID.
- Digests SHALL follow live authorization, privacy, and pay-display law.

## 17. Reliability and offline command behavior

- Cross-app mutations SHALL include `command_id`, semantic idempotency key,
  actor/source, contract/client/entity versions, device/effective/receipt time,
  timezone, client sequence, active department/membership version, evidence,
  and correlation ID.
- Command status SHALL be queryable after timeout/reopen. Retrying the same
  semantic operation SHALL return the original canonical result.
- Partial cross-system operations SHALL be visible and recoverable. Hub SHALL
  not roll back a Quote Tool clock by deleting a Hub run or vice versa.
- Dead-letter depth and oldest age SHALL alert through the existing Telegram
  bot. Replay SHALL be idempotent.
- Deploy smoke SHALL fail on contract-version, schema-version, or supported-
  version disagreement.
- Offline packet age, drift, GPS, and permission limits SHALL be configured by
  an approved contract rule before offline gated-job actions launch.

## 18. Retention and safety

- Wage-feeding time/pay/quality/approval/export/audit records SHALL be retained
  six years.
- Raw GPS route breadcrumbs SHALL be retained 120 days, then deleted or
  irreversibly aggregated unless legal hold applies.
- Placement original/derivative/metadata SHALL be retained indefinitely with
  backup, cost monitoring, legal hold, and authorized deletion policy.
- Exact GPS, addresses, route trails, pay, identity links, private notes, and
  signed media SHALL be least-privilege and access-logged.
- Advertising high-accuracy location SHALL run only for visible capture/run
  functions. Break SHALL pause installer route collection.
- Camera/map SHALL warn against operation while moving. The PWA SHALL not claim
  continuous background tracking or background upload while closed.

## 19. Deactivation

- Before deactivation the owner SHALL resolve or explicitly carry forward open
  day clocks, corrections, quality windows, pay/export blockers, placement
  acknowledgments, inventory allocations, command retries, and identity links.
- Deactivation SHALL revoke new operational access without destroying audit or
  final-pay records.
- Restricted owner access to retained records SHALL remain. Employee self-
  service duration is an owner decision and SHALL default to least privilege.

## 20. Release gates

The Hub SHALL NOT enter field build/release against this specification until:

1. accepted contract amendments are merged into Quote Tool `master`;
2. Hub mirror is byte-identical and both CIs validate one shared schema;
3. contract/deploy smoke, auth, idempotency, audit, RLS checklist, and
   impersonated-role tests pass;
4. affected open decisions in `MASTER-PLAN.md` section 15 are ruled;
5. iPhone and Android PWA tests cover camera permissions, offline restart,
   storage pressure, duplicate retry, partial failure, and recovery;
6. Naldo explicitly approves the master plan and a human authorizes build.
