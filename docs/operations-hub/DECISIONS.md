# Operations Hub decision log

> Every master-plan decision gets a row: what was decided, the options, who
> ruled, when, and which source plan or review supplied it. MASTER-PLAN.md may
> only contain decisions that are either agreed in both source plans (marked
> AGREED) or ruled here by Naldo (marked RULED). PENDING rows block the
> sections of the master plan that depend on them.

## Rulings pending from Naldo (from PLAN-COMPARISON.md section 7)

| # | Decision | Options | Recommendation | Ruling | Date |
|---|---|---|---|---|---|
| R1 | Sequencing vs Sept 21 season start | (a) hub attendance before advertising (b) interim quote-tool bot clock, migrate later (c) advertising slips | (b) | PENDING | |
| R2 | Attendance split: hub owns shifts/breaks, quote tool owns per-job labor spans + compensation config | confirm / restructure | confirm | PENDING | |
| R3 | Actual job time: explicit clock authoritative, GPS visits corroborate only | confirm / GPS-primary | confirm | PENDING | |
| R4 | One Telegram bot, webhook stays quote tool, hub actions relayed | confirm / second bot / bot cutover | confirm | PENDING | |
| R5 | Clock gate applies in hub UI as well as bot | yes / bot only / off | yes | PENDING | |
| R6 | v1 roles: owner/admin, office, installer, advertising; Manager tier designed but not provisioned | confirm / provision Manager now | confirm | PENDING | |
| R7 | One department per employee in v1, changeable with history | confirm / multi-department now | confirm | PENDING | |
| R8 | Pay math lives only in the quote tool; hub never duplicates payroll logic | confirm | confirm | PENDING | |

## Non-optional directives (acknowledged, not ruled)

| Directive | Source | Status |
|---|---|---|
| Performance pay never displayed as earned before its 7-day quality window clears, on ANY surface | CLAUDE-PLAN A3 (NY Labor Law 190/193) | BINDING |
| Six-year retention for wage-feeding attendance/time records (distinct from 120-day raw GPS) | CLAUDE-PLAN A5 / NY payroll records | BINDING |
| Installer field completion never triggers financial completion | Both plans + Naldo instruction | BINDING |
| Production fails closed; RLS before field launch | CODEX-PLAN 25 + code verification | BINDING |

## Already ruled by Naldo (2026-08-06, from the Claude-side Q&A rounds)

| Decision | Ruling |
|---|---|
| Source of truth: Quote Tool = customers, jobs, addresses, schedules, assignments, budgeted hours, financial status, canonical job status | RULED |
| Source of truth: Hub = employees, permissions, attendance, breaks, routes, job visits, campaigns, Placement Runs, placements, hotspots | RULED |
| Quality guardrail: forfeiture of unearned performance pay, never deduction; 7-day window; no carry-forward | RULED |
| Payout cadence: hours current week, performance pay following week | RULED |
| Pool = 3 installers; Jason out, hourly, approver | RULED |
| One team, per-day assignment; no fixed crews | RULED |
| Takedown paid plain hourly season 1 | RULED |
| Shadow mode before any pay flip | RULED |
| Drive time counts toward job hours | RULED |
| Weekly pay period, America/New_York | RULED |
| Season-1 guardrails: yellow slips, damage-as-yellow-slip, training bonus, referral bonus in; profit sharing out | RULED |
| Wage-floor flag deferred by owner | RULED (recorded, not revisited) |

## Codex-side open items (CODEX-PLAN.md section 29, not duplicated here)

22 items covering GPS thresholds and review approvers, door-hanger privacy,
forgotten-run reconciliation, offline queue limits, SMS/OTP provider, Telegram
launch actions, coworker location visibility, punch no-GPS behavior, and
storage budget. They block Codex build phases, not the master plan's
structure. Rulings land here as they are made.

## Open items owned by neither plan yet (PLAN-COMPARISON.md section 4)

Whole-day weather cancellation, vehicle cost, PTO/sick/holiday, worker
classification, physical paycheck delivery, customer reschedule notification,
new-hire onboarding checklist, off-season behavior.
