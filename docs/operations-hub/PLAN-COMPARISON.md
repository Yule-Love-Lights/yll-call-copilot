# Plan comparison: CODEX-PLAN.md vs CLAUDE-PLAN.md

> Written 2026-08-06 by the Claude side, per the merge protocol in CODEX-PLAN.md
> section 31. Inputs: both source plans read in full, CODEX-REVIEW-FINDINGS.md,
> an independent fresh-eyes comparison agent, and a code-reality verification
> agent run against this repo's actual code plus spot-checks of the quote tool
> codebase. Neither source plan was modified. MASTER-PLAN.md is not written yet:
> the rulings in section 6 go to Naldo first.

## 1. Where the plans agree (lock into the master plan as-is)

- Quote Tool is authoritative for customers, jobs, addresses, schedules,
  assignments, budgeted hours, financial status, and canonical operational job
  status. Hub is authoritative for employees, permissions, attendance, breaks,
  routes, job visits, campaigns, Placement Runs, placements, hotspots.
- Installer field completion NEVER silently triggers invoice or financial
  completion. Codex has the concrete mechanism (idempotent command,
  non-financial states such as `field_work_completed`); adopt its design and
  vocabulary.
- Integration is authenticated, versioned service APIs with idempotency keys,
  outbox/inbox delivery records, retries, dead letters, and audit correlation.
  Never direct cross-project database writes. Never last-write-wins.
- One Telegram bot, thin client, calling the same canonical service operations
  as the UI, with confirmation before consequential writes and full audit.
- Completion photos stored once, in the Quote Tool's existing job/design photo
  system; the hub stores references and uses signed access.
- Scheduling calendar is built in the Quote Tool (Claude Phase 3); the hub
  renders an installer's day read-only.
- UTC storage with a named business timezone for display and business-day
  grouping. Claude pins America/New_York explicitly; master plan adopts that
  name everywhere (Codex left the zone unnamed).
- Fail closed in production, RLS before field launch, server-side authorization
  on every mutation, audit on every channel, kill switches per subsystem.
- INTEGRATION-CONTRACT.md is written before any cross-system write is enabled.

## 2. Conflicts requiring Naldo's ruling (ranked by blast radius)

### C1. Phase sequencing vs the season (the big one)

Codex builds advertising first (its Phase 1), attendance second (its Phase 2),
all behind Phase 0 (identity/OTP migration, RLS, rename). Claude has a hard
date: installer time capture live by Sept 21, installs start the last week of
September. Code verification makes Phase 0 HEAVIER than the plan reads: the
current role model is a free-text column enforced as binary rep/not-rep, RLS
has never been enabled on any table (zero CREATE POLICY statements in the
migration history), the middleware fails open repo-wide when Supabase env is
missing, and no PWA scaffolding exists at all. Hub attendance by Sept 21 is
not realistic.

**Recommendation:** option (b), the interim bridge. The Quote Tool's Telegram
bot clock (Claude Phase 2) ships for Sept 21 exactly as planned, but its
events and field names are written to the shared contract shape so that when
hub attendance lands (Codex Phase 2), the bot's commands repoint to hub APIs
and history migrates by mapping, not rebuild. Codex's advertising timeline
proceeds unaffected. This also resolves the dependency trap the fresh-eyes
agent found: Claude's `crew_members` cannot reference a hub auth id that does
not exist yet, so it ships with `telegram_user_id` now and a nullable
`hub_employee_id` backfilled when Codex Phase 0 lands.

### C2. Attendance ownership end-state

Codex owns `shifts` and `breaks` in the hub (matches Naldo's ruling). Claude
put `job_time_entries` in the Quote Tool. These are different granularities:
day-level attendance (shift, break) vs per-job labor spans. The pay engine
needs both: day-level for the base floor and overtime, per-job for the pool
split and efficiency.

**Recommendation:** hub owns day-level attendance (shifts, breaks) as ruled.
The Quote Tool permanently owns per-job labor actuals (its `job_time_entries`)
because they are pay-math inputs, which is financial territory. Once hub
attendance is live, the hub feeds approved shift/break data to the Quote Tool
via events, and per-job spans are captured by the bot/hub UI but stored
quote-tool-side. `crew_members` in the Quote Tool becomes a cache keyed by the
hub's canonical `employee_id`, holding only what pay math needs: base rate,
pool membership, pay-mode flag, language.

### C3. Two mechanisms computing "actual job time"

Codex derives job visits from GPS dwell (Route Mode, five-minute rule, enter/
exit radii). Claude uses explicit per-job clock start/stop. Same number, two
mechanisms, two confidence profiles. GPS dwell cannot feed exact-cents pay
math: the PWA loses background location when the phone locks or navigation
apps take over (Codex says so itself).

**Recommendation:** the explicit clock is authoritative for pay. GPS-derived
visits are corroborating evidence and exception fuel: a visit with no clock
entry or a clock entry with no visit raises a review flag for Jason's queue.
This keeps Codex's Route Mode valuable without letting a suspended PWA
invisibly shrink someone's paycheck.

### C4. The Telegram single-webhook constraint

Codex correctly flags that one Telegram bot has exactly one webhook
destination. Claude's plan assumed uncontested quote-tool ownership of the
existing bot without stating that constraint. Verified: the bot, `bot_users`,
and the webhook route all live in the Quote Tool today; this repo has zero
Telegram code.

**Recommendation:** the webhook stays with the Quote Tool. There is no second
bot. Hub-owned actions reachable from Telegram (day clock in/out once hub
attendance is live) route: Telegram, Quote Tool webhook, canonical hub service
API, with source attribution `telegram` and shared idempotency keys. The
contract doc gets a section for exactly this relay.

### C5. Clock gate

Claude locked it ON (crew cannot see the day's schedule until clocked in,
server-side, office exempt). Codex's navigation shows installers their route
and clock controls with no gate. **Recommendation:** the gate is a locked
owner decision; Codex's installer home adopts it. Needs Naldo's confirmation
that it applies in the hub UI, not just the bot.

### C6. Manager role

Codex defines a Manager permission tier with cross-department visibility.
Claude's world has no managers: Naldo and Jason are the principals, then three
installers. **Recommendation:** v1 roles are owner/admin (Naldo, Jason),
office, installer, advertising. The Manager tier stays in the schema design
but is not provisioned in v1. Needs Naldo's confirmation.

### C7. Dual-department employees

Codex's model is one department per employee. The ruling names a future
yard-sign team, and in a 5-person seasonal company the SAME person may install
in December and place yard signs in March. Neither plan handles it.
**Recommendation:** v1 stays single-department (Codex's model), with
department changeable by Naldo/Jason and history preserved; true
multi-department membership is a recorded later item. Needs Naldo's nod.

## 3. Gaps in one plan, filled by the other (adopt, no ruling needed)

**Codex adopts from Claude:**

- The NY §193 legal machine: performance pay is provisional until a 7-day
  quality window clears, and NO hub surface (my-earnings, leaderboard, nudges)
  may label provisional pay as earned. This is a legal constraint on UI the
  hub will build; CODEX-PLAN.md never mentions it because the pay engine is
  outside its scope. It binds anyway.
- Six-year retention for any wage-feeding attendance data. Codex specifies
  120-day raw route retention; that is fine for GPS points, but shifts,
  breaks, and job time spans feed pay and fall under NY payroll record rules.
- `stoppage_reason` (weather / no-access / materials / other) on time and
  visit records from day one. Weather cannot be backfilled and poisons the
  budgeted-hours learning signal.
- America/New_York named explicitly as the business timezone.

**Claude adopts from Codex:**

- Breaks (unpaid, optional) as a modeled entity; Claude's pay math subtracts
  them. Claude's plan had no break concept at all.
- Time approval by Naldo OR Jason (either principal), which also answers
  Claude's open backup-approver item.
- The completion vocabulary and mechanism (`field_work_completed`,
  `completion_submitted_for_office_review`, idempotent command, event back).
- The exception-queue pattern (forgotten clock-out, open break at clock-out,
  duplicate punch, auto clock-out at midnight) as the office review surface.
- OTP identity, canonical `employee_id`, deactivation semantics, and the
  fail-closed rework of this repo's middleware.

## 4. Gaps in neither plan (new open items for DECISIONS.md)

1. Whole-day weather cancellation: who calls "no work today," how the crew is
   told, what it pays. Distinct from mid-job stoppage.
2. Vehicle cost: drive time counts toward job hours, but mileage/gas
   reimbursement is nowhere.
3. PTO / sick / holiday pay: no category exists.
4. Worker classification (W-2 vs 1099) for the pay engine's assumptions.
5. The physical paycheck: who cuts it, from what export, into what account.
   Codex excludes payroll from v1, Claude exports a breakdown CSV; nobody
   lands the money.
6. Customer notification when weather forces a reschedule (ties to the Quote
   Tool's existing comms, out of both plans' scope so far).
7. New-hire onboarding checklist: phone provisioning, Telegram pairing, hub
   account, crew_members row, training-pairing schedule.
8. Off-season behavior (Feb-Aug): pools paused, hourly only, system quiet
   mode. Claude's open item, still open.

## 5. Code-reality corrections (verified against actual code, 2026-08-06)

- This repo: email/password + `app_users` allowlist CONFIRMED; roles are a
  free-text column enforced as binary rep/not-rep (no enum, no admin/owner
  distinction in code); service-role Supabase access in all 68 API-route
  files; ZERO RLS policies anywhere in migration history; middleware fails
  open repo-wide when Supabase env is missing (`src/proxy.ts`); no PWA
  scaffolding whatsoever; no Telegram code. The `APPLY-THESE-*.sql` files in
  the tree are byte-identical concatenations of committed migrations
  (paste bundles, not schema drift).
- Quote Tool: `bot_users`, the Telegram webhook route, and `completeInstall`
  exist and are live. `crew_members` and `budgeted_hours` do NOT exist yet;
  they are Claude Phase 1 deliverables. Codex's ownership table lists budgeted
  hours as syncable Quote Tool data; true as ownership, not yet true as data.

## 6. Terminology alignment (one vocabulary for the master plan)

| Term | Master-plan meaning | Notes |
|---|---|---|
| Shift | Day-level clock-in to clock-out span (hub-owned attendance) | Codex's "attendance" |
| Break | Unpaid span inside a shift (hub-owned) | |
| Job time entry | Explicit per-job labor span (quote-tool-owned pay input) | Claude's term; authoritative for pay |
| Job visit | GPS-derived presence evidence (hub-owned) | Corroboration and exceptions, never pay |
| Route Mode | Foreground GPS sampling while clocked in (hub) | |
| Placement Run | Advertising productivity session (hub) | Not payroll time |
| Field completion | Operational done-ness via idempotent command (Codex states) | Never financial |
| Provisional / earned / paid / forfeited | Performance-pay states (quote-tool ledger, hub display) | Legal machine, Claude A3 |
| Clock gate | No schedule visibility before clock-in (all crew surfaces) | Locked ON |

## 7. Ruling sheet for Naldo

| # | Decision | Recommendation |
|---|---|---|
| R1 | Sequencing: hub reorders attendance first, OR interim quote-tool bot clock for Sept 21, OR advertising slips | Interim bot clock (C1) |
| R2 | Attendance end-state split: hub shifts/breaks, quote tool per-job labor + compensation config | Confirm C2 |
| R3 | Actual job time: explicit clock authoritative, GPS visits corroborate | Confirm C3 |
| R4 | Telegram: webhook stays quote tool, hub actions relayed, no second bot | Confirm C4 |
| R5 | Clock gate applies in hub UI, not just bot | Yes (C5) |
| R6 | v1 roles without a provisioned Manager tier | Confirm C6 |
| R7 | Single department per employee in v1 | Confirm C7 |
| R8 | Pay math exists ONLY in the quote tool; the hub never duplicates payroll logic | Confirm |

Directives that are not optional and need no ruling, only acknowledgment:
the provisional/earned display rule (legal), six-year wage-record retention,
and fail-closed production auth.

Codex's own section 29 list (22 items: GPS thresholds, door-hanger privacy,
review approvers, queue limits, SMS provider, and more) remains open and is
NOT duplicated here; those go to DECISIONS.md as Codex-side rows.
