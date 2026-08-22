# Yule Love Lights Operations Hub — master plan

Status: **owner-approved; canonical contract/schema mirrored; Phase 0 identity foundation merged**
Version: `1.3-review-1`
Approved: 2026-08-07
Last reconciled: 2026-08-20

## 1. Mission

YLL Call Copilot becomes **Yule Love Lights Operations Hub** at
`ops.yulelovelights.com`. It is the employee front door for office work,
advertising placement, sign inventory, installer field work, time capture,
personal statistics, internal leaderboards, and manager/owner review.

The Quote Tool remains the customer/job system of record, the canonical time
ledger, and the only pay engine. The two applications behave like one product
through a versioned contract; neither recreates the other's canonical facts.

The field experience must be as fast as SimpleCrew: an advertising employee
starts a Placement Run once, reopening the installed PWA goes straight to the
live camera, and each shutter becomes durable locally before the next capture.

## 2. Governing documents

Authority is scoped. `INTEGRATION-CONTRACT.md` governs all cross-repository
schemas, commands, events, canonical time, pay, and Quote Tool facts.
`DECISIONS.md` records Naldo's dated product rulings; a ruling that changes
contract-owned behavior is not implementation authority until incorporated
into the canonical contract under section 10 and mirrored byte-identically.
This master plan governs shared delivery, and `OPERATIONS-HUB-SPEC.md` governs
Hub-only behavior. Any conflict stops work at the affected boundary.

`CONTRACT-V1.3-PROPOSAL.md` is retained as historical review input. Its
accepted P1-P15 language now lives in the merged canonical
`INTEGRATION-CONTRACT.md`.

## 3. System ownership

### Quote Tool owns

- customers, quotes, job addresses, schedules, assignments, job state, and
  budgeted labor facts;
- every canonical paid-time fact: day clock, breaks, job segments, travel,
  approvals, locks, and adjustments;
- operational completion state and completion-photo references;
- compensation configuration, installer performance-pay calculation,
  advertising piece-rate/floor calculation, quality windows, earnings states,
  payroll readiness, and payroll CSV export;
- the single Telegram bot webhook and consequential bot command handling;
- `/api/ops/v1`, shared labor tables, and the canonical integration contract.

### Operations Hub owns

- phone/OTP UI, Hub sessions, employees, roles, department memberships, and
  Hub authorization policy;
- office/call coaching surfaces already in this repository;
- campaigns, Placement Runs, placements, capture media, hotspots/avoid zones,
  route evidence, and advertising review queues;
- the sign-inventory ledger: stock, allocations, transfers, placements,
  returns, damage/loss observations, restock, and corrections;
- PWA camera/offline queues, Hub audit records, and read-model presentation;
- four digest-type compositions, using canonical facts from each owner.

### Shared boundary

One immutable mapping joins Hub employee, Quote Tool crew member, phone, and
Telegram identity. Cross-app writes use authenticated, authorized, versioned,
idempotent commands and append-only events. A user-visible state must identify
whether it is local, submitted, accepted, under review, rejected, or adjusted.

## 4. Identity, roles, and department context

- Current sign-in is invite-only email/password under Decision 25. Supabase
  Phone Auth with Twilio Verify delivery remains the approved long-term target,
  but phone OTP, Turnstile, recovery/reassignment, and password-identity
  revocation are disabled and deferred until a later owner activation decision.
- A later phone-auth activation requires Turnstile on OTP request, resend, and
  recovery. Recovery is an audited Naldo/Jason-only action; there is no
  employee self-service phone reassignment or recovery in V1. A Hub session has
  a maximum 30-day lifetime and may end sooner on logout, deactivation,
  revocation, or security review. Existing password identities are revoked only
  when phone auth activates; the Supabase console is the audited owner-only
  break-glass path.
- Naldo and Jason are the only provisioned owner/admin identities in V1 and can
  see all departments. Jason is primary time approver; Naldo is backup.
- Employee roles are Office, Advertising, and Installer. A Manager capability
  tier is designed and tested but **not provisioned in V1**.
- Management is an owner/admin view and digest type, not an employee department
  membership or paid-work context.
- The Hub exposes exactly four UI modes: Management, Office, Advertising, and
  Installer. Naldo/Jason always land in Management and use department
  drilldowns that do not impersonate an employee or change paid context.
- Every other employee has an explicit primary home mode. The Hub never makes
  last-used mode the next login default, and shows a mode switcher only to an
  employee with multiple active department memberships.
- An employee may hold multiple department memberships. Exactly one active
  department-context interval is active at each instant of a canonical paid
  shift. Switching context is an explicit, audited Quote Tool operation and
  cannot silently move already recorded time.
- Outside a paid day, mode selection changes view only. During paid work, Hub
  uses the canonical Quote Tool context switch and rejects with review during
  an active Placement Run or open Installer job segment. That final owner rule
  requires a canonical P16.2 amendment before it becomes cross-repository
  contract authority. Open-break final policy remains unresolved, so the
  current canonical safe default continues to reject with review.
- Membership union may expose non-sensitive module navigation only. Sensitive
  reads and actions require an explicit capability, the current paid-work
  context, and assignment/resource scope. A secondary membership never bypasses
  the clock gate. Office work uses a separate resource-scoped office operation,
  not an installer endpoint.
- Department membership is not compensation authority. Pay configuration and
  effective dates remain Quote Tool facts.
- "Public" means visible only to active YLL employees. Public screens never
  reveal pay amounts, customer contact information, exact private routes, or
  residential door-hanger locations.
- Quote Tool identity, canonical-time, lifecycle-event, and command work may
  proceed independently of the deferred Hub phone-auth target and in parallel
  with compatible Hub-owned foundation work, subject to the canonical contract
  and release gates.

## 5. One paid day, multiple work modes

- The Quote Tool owns a single non-overlapping paid-day envelope in
  `America/New_York`.
- Manual Clock In, Break, Arrived, Departed, and Clock Out commands are primary
  for pay. GPS corroborates, identifies missing taps, and can suggest visits;
  it does not create payable time by itself in V1.
- Travel is explicitly classified or remains a visible unclassified residual.
  It is never inferred twice or added on top of another travel allowance.
- Clock Out closes open work state at the requested effective time and creates
  review flags when a run, visit, or break was still open.
- Midnight auto-close is a review backstop, not an invisible correction.
- Employees submit correction requests. Naldo/Jason approve append-only
  corrections; exported periods are changed by later adjustment rows, never
  rewritten.
- Wage-feeding records are retained for six years. Raw Hub GPS breadcrumbs are
  retained for 120 days, then deleted or irreversibly aggregated unless under
  legal hold.

## 6. Advertising workflow

### Placement Run and camera

The advertising home screen has one primary **Start Work & Placement Run**
action for an assigned campaign. It obtains an accepted Quote Tool day clock
when needed and starts the Hub-owned run. Partial success is shown plainly and
is recoverable; the UI never pretends that both systems accepted when only one
did.

A new Placement Run requires an online, server-accepted start. That accepted
run may authorize up to 12 hours of offline capture. Work outside the authorized
window, or arriving after employee/device deactivation or revocation, is
quarantined for owner review and is never silently accepted, discarded, or
counted for pay or inventory. The credential shape and activation path remain
part of the later OTP/offline implementation PR, not this identity-foundation
slice.

While a run is active:

- opening the installed PWA routes directly to Camera Mode;
- the campaign is locked for that run;
- a live-camera shutter stores the original image and required metadata in a
  durable local record before resetting for the next photo;
- upload, reverse geocoding, review, stamping, and numbering occur in the
  background without blocking the next shutter;
- optional notes never block capture;
- settings, flash, camera flip, queue status, map guidance, and End Run remain
  reachable from the camera screen.

The X ends the Placement Run, returns to the Hub home screen, and offers a
short Undo plus an optional Clock Out action. Ending the run does not silently
end the paid day. If the employee clocks out while a run is open, the run
closes at the last durable shutter and both records receive an end-of-day
review note. A forgotten run reconciles at local midnight to its last durable
shutter; a zero-photo run is abandoned/reviewed.

### Placement facts and lifecycle

- Yard signs represent unique roadside/intersection/pole/grass placement
  spots—not customer houses. Door hangers use a separate campaign type and
  privacy policy.
- Live camera is required for verified placement. Gallery media, if enabled
  later, is visibly unverified and cannot silently feed accepted pay counts.
- Required evidence includes employee, campaign, run, capture and receipt
  times, latitude/longitude, reported accuracy, GPS sample time, camera
  provenance, device/idempotency identifiers, media checksum, and derived
  address.
- GPS target is 1–5 m when the device can provide it; the product cannot promise
  phone-GPS precision. The UI labels 0–5 m excellent, >5–10 m good, >10–20 m
  accepted with warning, >20 m review, and missing location unverified. A
  missing fix can be attached only from a short same-camera stationary grace
  window with the time delta recorded.
- Each campaign numbers accepted placements atomically from 1. Numbers never
  change or get reused; voids create permanent gaps.
- Lifecycle is `captured_local`, `queued`, `submitted`, `under_review`, then
  `accepted`, `rejected`, or `voided`. An accepted record may later be
  `reversed` only through an append-only review action.
- The employee may undo their latest placement during a five-minute window.
  Blur does not fail a placement; missing evidence affects verification.
- Original photo, derivative, thumbnail, and placement metadata are retained
  indefinitely, subject to authorized deletion/legal hold and cost monitoring.

### Offline behavior

- The next capture is available after local durability, not after network
  upload.
- Queue states are Saved on device, Waiting to sync, Uploading, Submitted,
  Under review, Accepted, Rejected, and Needs attention.
- Automatic retry resumes while active and on reopen; Retry/Retry All is
  available. Duplicate commands return the original result.
- Final media, placement, number, audit, inventory, and outbox effects are
  atomic or recoverable.
- The PWA warns about storage pressure and pending items and never promises
  survival after uninstall, site-data clearing, device loss, or OS eviction.

### Inventory and pay input

- Sign Number and physical inventory are separate concepts.
- Inventory uses an append-only ledger: receive/restock, issue weekly
  allocation, transfer, place, return, damage/loss observation, and correction.
- Expected back equals issued plus transferred in minus transferred out minus
  accepted sign placements. Returned inventory, approved damage/loss, and
  variance remain separate facts for review and restock planning; none is a
  wage deduction.
- Quote Tool pay consumes acknowledged accepted-placement counts, not camera
  shutters, inventory subtraction alone, or Hub-calculated money.
- Initial advertising compensation is $2.50 per accepted placement with a
  $17/hour floor true-up over the canonical day clock. Rates are effective-
  dated Quote Tool configuration, and all calculation/export remains there.
- A week cannot close for advertising pay while accepted/reversed placement
  events or inventory reconciliation are unacknowledged.

## 7. Installer workflow

- Before accepted clock-in, installers see only a non-sensitive summary: date,
  start time, crew, and preparation notes. The Quote API—not merely the UI—gates
  exact addresses, customer contacts, routes, and job actions.
- After clock-in, installers see assigned jobs, route/order, job notes, design
  and load list, budgeted crew hours, crew roles, and status.
- One-tap Arrived/Departed is authoritative for job-time allocation. GPS route
  evidence flags mismatches and may suggest a missed visit after calibration.
- A dwell of five or more minutes may become a suggestion, never automatic pay
  truth. The employee or Naldo/Jason confirms/corrects it.
- Completion has two dimensions: field-work state and office-review state.
  Field completion never performs financial completion.
- Completion media is optional and never blocks the completion command. The
  surface prompts at most three times, then permits completion without media.
  If the employee does attach media, the offline draft preserves those files
  until their upload state and the canonical command are acknowledged by the
  Quote Tool.
- Materials used, quantities, estimated quantities, optional on-hand true-up,
  notes, photo references, and raw command text use the same canonical
  operation in PWA, Telegram, and office surfaces.

## 8. Office workflow

- Office employees clock in/out against the Quote Tool day ledger and record
  required unpaid breaks. Their default home exposes office/call tools only.
- Existing Call Copilot coaching, calls, transcripts, scorecards, and personal
  trends are preserved during the rename.
- Each statistic states its period, source-through time, numerator,
  denominator, exclusions, provisional status, and later adjustments.
- Office call metrics and seller attribution use stable employee identity and
  canonical events; the Hub does not join people by display name.
- When an attributed sale is installed, the selling employee may receive an
  internal notification and the Quote Tool may enqueue review/referral work.

## 9. Owner/admin workflow

Naldo and Jason can see every department, identity link, current shift, review
queue, accepted/rejected placement, exact authorized map, inventory variance,
time exception, completion review, digest, export readiness state, and audit
trail. They can approve or append corrections only through canonical owner
operations. Destructive overwrites are not allowed.

Deactivation must expose unresolved time, pay, quality, inventory, command, and
identity-link issues before access is removed. Final-pay data remains available
to restricted owners for the required retention period.

## 10. Pay, statistics, and leaderboards

- Quote Tool supplies integer-cent pay facts and status; the Hub never computes
  payroll or infers earnings state.
- Provisional installer performance pay renders exactly **Pending quality
  review** with its close date. It never appears as earned, made, owed, paid, in
  earned totals, on leaderboards, or in payroll export before the seven-day
  quality window clears.
- Forfeiture means an amount never became earned; it is never a deduction from
  wages. Evidence and an employee response step are required.
- Advertising performance shows placements per hour, but any count affecting
  pay comes from the acknowledged accepted-placement ledger.
- Employee-visible statistics may include placements, accepted/review/rejected
  counts, placement rate, hours, jobs completed, budgeted versus actual crew
  hours, time per job, and personal trends. Team leaderboards show approved
  operational metrics only, never pay amounts or private location details.
- Before any compensation flip: shadow reporting, written terms, attorney and
  payroll review, required notices in the employee's primary language, and an
  explicit per-person effective-dated enablement. Raw CSV is V1; QuickBooks is
  later.

## 11. Telegram and four digests

- One Telegram bot and webhook remain Quote Tool-owned.
- Consequential bot actions call the same canonical operation as the PWA,
  deduplicate by Telegram update and semantic operation, reply within two
  seconds that processing began, and later send the final accepted/review/
  rejected result.
- Advertising Telegram V1 provides status and a deep link to Camera Mode; a
  Telegram photo is not a verified placement.
- Four digests exist: Office, Advertising, Install, and Management. Each
  of the first three combines attendance with that department's operations.
  Management combines authorized cross-department owner/admin facts without
  becoming a department or paid-work context. Naldo and Jason receive all four;
  employees receive only their authorized view.
- The Hub composes and tracks delivery; each owner supplies canonical facts.
  Digests obey the same privacy and Pending quality review rules as live UI.

## 12. Reliability, security, and observability

- Production fails closed. RLS/authorization is a per-table/per-endpoint
  checklist tested by impersonating every role before field launch.
- Every cross-app command records command ID, semantic idempotency key, actor,
  source, device/effective/receipt times, contract and entity versions, active
  department, and correlation ID.
- Commands expose queryable state. Dead-letter queue depth alerts through the
  existing Telegram bot. Operators can replay safely without duplicate time,
  pay, inventory, or placement effects.
- Deploy smoke fails if contract, schema, or supported-version values disagree.
- Exact GPS, customer addresses, route trails, pay, private notes, signed media,
  and identity links are least-privilege and access-logged.
- Route collection pauses for breaks; advertising high-accuracy GPS is limited
  to visible capture/run behavior. The PWA warns against camera/map use while a
  vehicle is moving and makes no claim of continuous background tracking.

## 13. Delivery plan

### Phase 0 — joint contract and safety gate

1. Claude updates the Quote Tool canonical contract from the accepted parts of
   `CONTRACT-V1.3-PROPOSAL.md`; Naldo and Codex review; human merge to Quote
   Tool `master` first.
2. Generate/publish one shared JSON Schema artifact; both CIs validate it.
   Quote Tool PR #803 first published schema `1.0.0-draft`; PR #878 advances
   the current Flow Q contract pack to schema `1.1.0-draft`.
3. Add byte-identical canonical-contract and schema mirrors to the Hub after
   canonical merge; cross-repository byte-diff and deploy-version smoke must
   pass. The raw-byte mirror and local/cross-repository verifier are complete;
   trusted authenticated CI now compares current Quote Tool `master`; live
   deploy-version health remains.
4. Lock identity-link, command/event envelope, auth, audit, idempotency, RLS,
   DLQ, kill switches, and ownership rows in both repositories.

### Approved implementation sequence after Phase 0

Hub product work and release proceed in exactly this order:

1. **Management:** Quote Tool-matched shell, primary-mode routing, truthful
   Hub-local summaries, and an owner-only Naldo/Jason preview.
2. **Office:** preserve and redesign the existing call/coaching workflows, add
   Hub-owned tasks, and consume real Quote-owned lifecycle facts when ready.
3. **Advertising:** campaigns, Placement Runs, Camera Mode, durable offline
   capture, GPS/review, maps, inventory, reconciliation, hosted personas, and a
   real-device field pilot.
4. **Installer:** canonical schedule/job reads and commands, context-preserving
   field UI, completion/retry/reconciliation, hosted personas, and a real-device
   field pilot.

Quote Tool contract, identity, lifecycle-event, current-context, schedule,
completion, and command work may proceed in parallel with compatible Hub-owned
foundations. A dependent Hub surface does not become ready until its canonical
interface is merged, mirrored byte-identically, version-compatible, and proven
through its applicable authorization and release gates.

Actual installer performance pay and advertising payroll output remain behind
separate flags and professional/owner gates. External Copilot CRM/Homeworks is
retired only after schedule/time parity, remaining integration review, and two
clean weeks.

## 14. Launch acceptance

- No cross-repository build uses an unmerged or mismatched contract.
- All critical offline/retry/duplicate/partial-failure flows pass on iPhone and
  Android installed PWAs.
- A placement can be traced from shutter to accepted/reversed event, inventory
  movement, acknowledged pay input, statistics, and export blocker state.
- A workday reconciles clock, breaks, visits, travel/unclassified residual,
  corrections, lock, and export without overlap or double count.
- Exact-address clock gate is enforced server-side.
- Multi-department impersonation tests prove that a secondary Office membership,
  stale membership version, wrong active context, unassigned resource, or
  unprovisioned Manager claim cannot expose sensitive data.
- Provisional pay wording and exclusion pass API, UI, Telegram, digest,
  leaderboard, and CSV tests.
- No employee can see another employee's pay, exact private route, restricted
  residential data, or owner-only audit data.

## 15. Decisions still required before their affected feature ships

- Offline signed-packet age, device-clock drift, and GPS evidence limits.
- Department switch rules during an open job/run and who may approve them.
- Exact installer travel classification and missed-tap thresholds.
- Placement rejection/reversal reason codes, reviewer SLA, and week-close role.
- Door-hanger capture unit and any residential visibility broader than the
  contract's restrictive employee/Naldo/Jason default. Door-hanger pay is OFF
  under ruling P16.5.
- Completion media is optional and uses at most three prompts under provisional
  ruling P16.6. The installed notification fires on contract-defined
  `field_work_completed`.
- Office qualified-call formula and seller-credit correction rules.
- Digest recipient selection within each department and delivery escalation.
  Schedule is daily at 08:00 America/New_York; Naldo/Jason receive all four
  under P16.8. Implementers MUST NOT interpret "per-department recipients" as
  every department member until Naldo defines the recipient-selection rule.
- Deactivated employee self-service duration.
- Payroll-vendor mapping and ordering beyond the ruled generic V1 CSV. The
  contract defines stable `pay_line_id` values and the `employee_subtotal` row;
  no implementation may change those amounts or fields outside the contract
  process.
- Overtime/blended-rate handling, meal-period policy by role, and all legal/payroll
  language. These block pay activation, not safe shadow reporting.

## 16. Approval

- [x] Claude confirms Quote Tool ownership and contract feasibility through
      merged Quote Tool PR #701 and canonical contract `v1.3.0-draft`.
- [x] Codex confirms the paired canonical proposal and Hub mirror are
      byte-identical (SHA-256
      `2fc10d33bf592b79d38741e8f40bdc1abcf52c2233d3be89521807211bbafa4a`)
      and `OPERATIONS-HUB-SPEC.md` requires the Hub to consume canonical Quote
      Tool time/pay facts rather than calculate them.
- [x] Naldo approved and human-merged the self-contained v1.3 clarification in
      Quote Tool PR #716 (`5d56ebb62e23b2fe592cdc1912359b1ddf137270`);
      Hub PR #37 is byte-verified against that merged canonical source before
      implementation consumes it.
- [x] Naldo: `I approve MASTER-PLAN 1.3-review-1 as the implementation plan.`
      Signed 2026-08-07.
- [x] Naldo authorizes Phase 0 to start. Each implementation PR still requires
      its own current-branch gates, security review, green CI, and human merge.
- [x] Hub PR #44 mirrored the canonical `v1.4.0-draft` Flow H update at
      `master@0756b611c1e3bd7d6d3eeb4318b8677412ae0ad7`; the contract mirror
      remains canonical Quote Tool-owned and is not edited by Hub identity work.
- [x] Quote Tool PR #878 published the canonical `v1.5.0-draft` Flow Q
      lifecycle/current-context/authorization-snapshot contract and schema
      `1.1.0-draft` at merge
      `ad53321eb5cf548bf9fe9adf400a5786a2d4fe44`; Hub PR #70 vendors those exact
      bytes. The current branch records the remaining schema blockers without
      activating the runtime.
- [x] Hub PR #50 merged the immutable Hub identity foundation at
      `master@44989e1ac1c7830ffdcd4d1e1f623db692547e9e`; all required Hub CI,
      pgTAP, build, and Vercel checks passed before the human-authorized merge.
- [x] Naldo approved the reconciled four-mode implementation plan on
      2026-08-20. Hub delivery is Management, then Office, then Advertising,
      then Installer; compatible Quote Tool dependency work may proceed in
      parallel without bypassing any release gate.
