# Yule Love Lights Operations Hub — MASTER PLAN (draft v1)

> **Status:** Claude-drafted v1, 2026-08-06, built strictly from CODEX-PLAN.md,
> CLAUDE-PLAN.md, PLAN-COMPARISON.md, and the rulings in DECISIONS.md. Awaiting
> Codex's counter-review and Naldo's final approval. Once approved, this file is
> the implementation authority and both source plans become historical.
> Provenance is cited inline: (CODEX §n), (CLAUDE An), (DECISIONS Rn).
> Nothing here may contradict a DECISIONS.md ruling; if it does, the ruling wins
> and this file has a bug.

## 1. The system in one page

Two applications, one operation:

- **Quote Tool** (`yll-quote-tool`): the business system of record. Customers,
  quotes, jobs, addresses, scheduling calendar, assignments, budgeted hours,
  pricing, invoices, financial status, canonical job status, the Telegram bot,
  and ALL pay math (DECISIONS R8).
- **Operations Hub** (this repo, becoming `yll-operations-hub` at
  `ops.yulelovelights.com` per CODEX §25A): the employee system of record and
  the field surface. Employees, auth, roles, departments, attendance (shifts,
  breaks), Route Mode, job visits, advertising campaigns, Placement Runs,
  placements, hotspots, and the existing call/coach office tools.

They integrate through versioned, authenticated, idempotent service APIs with
outbox/inbox delivery and full audit (CODEX §20). Never direct cross-database
writes, never last-write-wins, one owner per field.

The pay model is P4P (pay for performance): each job carries budgeted hours and
a labor-revenue figure; the install crew's pool is labor revenue times a
percentage, split by hours, floored at base rate, with performance pay subject
to a 7-day quality window before it is earned (CLAUDE A3). Pay runs in shadow
mode until Naldo flips it.

## 2. Source-of-truth boundary (final)

| Data | Owner |
|---|---|
| Customers, contacts, addresses | Quote Tool |
| Jobs, job status (canonical), schedules, assignments | Quote Tool |
| Budgeted hours, labor revenue, production rates | Quote Tool |
| Financial status, invoices, deposits | Quote Tool |
| Compensation config (base rates, pool membership, pay-mode flag) and the P4P ledger | Quote Tool (DECISIONS R2, R8) |
| Per-job labor spans used by pay math | Quote Tool table, fed by Hub-approved visits (DECISIONS R2, R3) |
| Employees, auth identities, roles, departments, permissions | Hub (CODEX §7, §24) |
| Attendance: shifts, breaks | Hub |
| Route sessions, route points, job visits | Hub |
| Advertising: campaigns, Placement Runs, placements, hotspots | Hub |
| Completion photo binaries | Quote Tool job/design photo system; Hub stores references (CODEX §19) |
| Telegram webhook | Quote Tool, permanently one bot, relay pattern (DECISIONS R4) |

## 3. Identity, roles, departments

- Canonical `employee_id` (UUID) lives in the Hub. Phone-number OTP sign-in,
  no self-signup, provisioning only by Naldo/Jason, deactivation revokes
  sessions AND is re-checked server-side on every protected call (CODEX §7).
- The Quote Tool keeps a `crew_members` cache row per employee: hub
  `employee_id`, `telegram_user_id`, base rate, pool membership, pay-mode
  flag, language. It is a cache plus pay-config, never identity truth
  (PLAN-COMPARISON C2). It ships in Quote Tool Phase 1 with `hub_employee_id`
  nullable until Hub Phase 0 lands, then backfills.
- **v1 roles:** owner/admin (Naldo, Jason), office, installer, advertising
  (DECISIONS R6). The Manager tier from CODEX §6 stays in the schema design,
  provisioned to nobody.
- **Departments are many-to-many from day one** (DECISIONS R7, supersedes
  CODEX §6's one-department rule). An employee holds one or more department
  memberships with history. Permissions are the union of memberships. If an
  employee has multiple departments, the home screen shows a department
  switcher with the last-used department as default; single-department
  employees get that department's home directly (preserves CODEX §5 principle
  1). Placement capture requires an advertising membership; installer
  route/completion requires an installer membership.
- Per-profile language option covers crew UI and all earnings/quality text
  (CLAUDE A2).

## 4. Time and attendance architecture

- **Day-level attendance** (clock in/out, optional unpaid breaks) is Hub-owned
  for office, installers, managers-if-ever; advertising employees use
  Placement Runs, not payroll attendance, in v1 (CODEX §17).
- **Clock gate ON** for installers across every surface: no schedule/route
  visibility before clock-in, enforced server-side against one canonical open
  shift, office/admin exempt by role (CLAUDE A2, DECISIONS R5). A documented
  override path (Jason clocks someone in remotely) ships with it; dead phones
  happen (CLAUDE A6).
- **Pay-feeding job hours: GPS visits are primary** (DECISIONS R3, owner's
  call). Route Mode dwell detection creates visits (CODEX §18); low-evidence
  visits are suggestions requiring confirmation; one-tap Arrived/Departed and
  bot punches are the correction path. **The visit approval queue is
  pay-critical: approvals must complete before each weekly payroll.**
- Approved visits and shifts flow to the Quote Tool as events and land in its
  per-job labor table; that table is what the pay engine reads (DECISIONS R2).
- Approval authority: Naldo or Jason only, employee corrections are requests,
  every edit is append-only with before/after and actor (CODEX §17, CLAUDE
  A5 Phase 2 audit rules).
- `stoppage_reason` (completed / weather / no-access / materials / other) on
  visit and shift records from day one; weather-flagged spans are excluded
  from the budgeted-hours learning signal and cannot be backfilled
  (CLAUDE A5 Phase 2).
- Auto clock-out at midnight; forgotten shifts go to the exception queue, not
  silently into payroll (CODEX §17, CLAUDE A5 Phase 2).
- Exception queues for launch: forgotten clock-out, duplicate punch, open
  break at clock-out, active visit at clock-out, overnight/DST, correction
  requests, approved-period locking (CODEX §17).
- UTC storage, America/New_York for display, business-day grouping, and the
  weekly pay boundary (CLAUDE A2, PLAN-COMPARISON §1).
- **Retention:** raw route points 120 days (CODEX §18); anything wage-feeding
  (shifts, breaks, approved visits, labor spans, pay ledger) six years,
  append-only (CLAUDE A5, NY payroll records; PLAN-COMPARISON C-list).

## 5. The pay engine (Quote Tool only)

Everything in CLAUDE A3 and A5 Phase 4 binds, unchanged in substance:

- Per-category labor % on pre-tax labor subtotal, conservative default for
  unmapped categories, pool computed at invoice-final never quote-approval,
  never-invoiced jobs pay no pool.
- Budgeted hours derived from design geometry with office override; seed
  production rates from the Naldo+Jason session, calibrate from actuals.
- Integer cents end to end, remainder cents to the crew, largest-remainder
  split.
- Base-floor true-up per person per week at max(base rate, legal minimum),
  configurable per person; floor-true-up alarm holds the pay flip when the
  rates are wrong.
- **The legal machine (non-optional):** performance pay is
  `provisional -> earned -> paid`, or `forfeited` on a yellow slip inside the
  7-day quality window; capped to the job, no carry-forward, base pay never
  touched. NO surface in either system, including Hub leaderboards,
  my-earnings, and bot nudges, may label provisional amounts as earned. Hours
  pay in the current week, performance pay the following week after the
  window clears. Written comp plan and NY pay-rate notices before any flip
  (CLAUDE A3, A5 Phase 6; DECISIONS binding directives).
- Shadow mode until Naldo flips; the pay-mode flag on `crew_members` is the
  rollback lever.
- The Hub renders earnings via the Quote Tool's earnings API, which returns
  provisional and earned separately; the Hub displays them distinctly
  (CLAUDE A8). The Hub never computes pay (DECISIONS R8).

## 6. Advertising (adopted from Codex wholesale)

CODEX §§9-16 are adopted as written: campaigns and types, the Placement Run
state machine, one-tap start, Camera Mode and the one-shutter pipeline,
GPS accuracy tiers and review states, server-atomic Sign Number allocation
with `Number pending` offline, the offline queue and upload finalization
contract, original+stamped media, maps, hotspots with provenance labeling,
field safety rules, and the unique-spot metric constraints. Codex's §29 open
items govern their remaining details. This master plan adds only one
constraint: any advertising leaderboard that ever shows money follows the
provisional/earned display rule in section 5.

## 7. Scheduling

The Quote Tool builds the full calendar: crew assignment, drag-drop week and
month views, unscheduled-work list, dispatch/day view, capacity from budgeted
hours divided across assigned crew (CLAUDE A5 Phase 3). The Hub renders an
installer's day read-only from the assigned-jobs read model (CODEX §18). The
Copilot CRM Zapier feed (#84) retires when the calendar ships.

## 8. Field completion

Codex's mechanism and vocabulary are adopted (CODEX §19): the Hub or Telegram
sends an idempotent field-completion command; the Quote Tool validates and
stores a non-financial state (`field_work_completed`,
`completion_submitted_for_office_review`), publishes the event back, and
nothing financial happens implicitly, ever. Completion photos post through
the Quote Tool's existing photo path; the Hub keeps references. The existing
`completeInstall` bot flow is the canonical operation to extend, not
duplicate (CODEX §4B).

## 9. Telegram

One bot, webhook stays with the Quote Tool (DECISIONS R4). The bot is a thin
client calling canonical service operations with the same permissions as the
UI (CODEX §21). Hub-owned actions reached via Telegram (day clock, visit
confirmation) relay: Telegram -> Quote Tool webhook -> Hub service API, with
source `telegram`, shared idempotency keys, reply-bound confirmations, and
`update_id` dedup. Verified placements can never originate from Telegram
photos (CODEX §21).

## 10. Integration

INTEGRATION-CONTRACT.md (same folder) is the single definition of endpoints,
events, auth, and shapes. Build rule: neither side builds against an endpoint
or event that is not in the contract. Schema migrations for the Quote Tool's
labor tables have one author, the Quote Tool's assistant; the Hub's schema
has one author, Codex (CLAUDE A4, CODEX §31 spirit). Every new
customer/crew-reachable Quote Tool route enters `operatorGate`'s allowlist in
the same PR, verified logged out (CLAUDE A8).

## 11. Sequencing (per DECISIONS R1)

1. **Now, independent tracks:**
   - Hub Phase 0 (CODEX §27): identity, OTP, RLS from zero, fail-closed
     middleware inversion, rename/domain staging, kill switches. Code
     verification says this is heavy; it gates everything Hub-side.
   - Quote Tool Phase 1: budgeted hours + labor revenue + `crew_members`
     cache (needs the Naldo+Jason seed-rates session).
   - Quote Tool Phase 3 build can start any time: the scheduling calendar.
2. **Hub Phase 1: advertising field release** (CODEX §27), Naldo's priority.
3. **Hub Phase 2: attendance + Route Mode + visits.** Installer time capture
   begins here, mid-season. The visit approval queue duty starts immediately.
4. **Quote Tool pay engine (CLAUDE Phase 4)** once approved visit/shift events
   flow. Shadow mode first; weekly economics ritual gets real numbers from
   this point.
5. **Hub Phase 3: Telegram relay actions + sync hardening** (CODEX §27).
6. **Guardrails + pay flip** (CLAUDE Phase 6): comp plan signed, attorney
   review, WTPA notices, then the flip when Naldo trusts the numbers.
   Realistically takedown season or next year (DECISIONS R1 consequences).
7. **Copilot CRM cancellation:** after the Quote Tool calendar AND Hub
   attendance are both live and clean for two weeks.

Accepted consequence: the season's first weeks have no per-job time data
(DECISIONS R1). Recorded, owner-chosen, not a surprise for later.

## 12. Security and compliance (binding)

CODEX §25 adopted in full: RLS before field launch, fail closed, server-side
authorization everywhere, signed media URLs, audit with actor/source/
correlation on every channel, atomically persisted audit for consequential
writes, rate limits, no secrets or coordinates in logs, kill switches per
subsystem. Plus the Claude-side binding items: the provisional/earned display
rule, six-year wage-record retention, and the wage-floor configurability
(DECISIONS binding directives; the below-minimum-rate flag stays deferred by
owner, recorded in CLAUDE A2/C3).

## 13. Open items

Live in DECISIONS.md: Codex's 22 build-detail items (its §29), the
neither-plan gaps (whole-day weather cancellation, vehicle costs, PTO,
W-2/1099, paycheck delivery, customer reschedule notification, onboarding
checklist, off-season), and the Claude-side product opens (weather pay rule,
clock-gate override detail, success metrics, labor % dial, takedown date).
None block starting section 11 step 1.

## 14. Provenance

Sections 3-4: merged CODEX §§6-7, 17-18 with CLAUDE A2/A5 under rulings
R2/R3/R5/R6/R7. Section 5: CLAUDE A3/A5 under R8. Section 6: CODEX §§9-16.
Section 7: CLAUDE A5 Phase 3. Section 8: CODEX §19. Section 9: CODEX §21
under R4. Section 11: DECISIONS R1. Section 12: CODEX §25 + CLAUDE binding
directives. Full conflict analysis: PLAN-COMPARISON.md. Ruling log:
DECISIONS.md.
