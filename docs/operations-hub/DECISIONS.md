# Operations Hub decision log

> Every master-plan decision gets a row: what was decided, the options, who
> ruled, when, and which source plan or review supplied it. A ruling that
> changes cross-repository, canonical time, pay, or Quote Tool behavior is not
> implementation authority until it is incorporated into the canonical
> contract and mirrored byte-identically. Pending rows block only the affected
> feature unless this log says otherwise.

## Rulings pending from Naldo (from PLAN-COMPARISON.md section 7)

| # | Decision | Options | Recommendation | Ruling | Date |
|---|---|---|---|---|---|
| R1 | Sequencing vs Sept 21 season start | (a) hub attendance before advertising (b) interim quote-tool bot clock, migrate later (c) advertising first, time waits | (b) | RULED: (c) advertising first, installer time capture arrives mid-season. The Sept 21 time-capture target is retired; consequences recorded below. | 2026-08-06 |
| R2 | Attendance split: hub owns shifts/breaks, quote tool owns per-job labor spans + compensation config | confirm / restructure | confirm | RULED: confirmed | 2026-08-06 |
| R3 | Authoritative mechanism for pay-feeding job hours | explicit clock primary / GPS visits primary | explicit clock | RULED: GPS visits primary (against recommendation, owner's call). Clock punches become the backup/correction path. Consequences recorded below. | 2026-08-06 |
| R4 | One Telegram bot, webhook stays quote tool, hub actions relayed | confirm / second bot / bot cutover | confirm | RULED: confirmed, relay pattern | 2026-08-06 |
| R5 | Clock gate applies in hub UI as well as bot | yes / bot only / off | yes | RULED earlier: Naldo locked the gate ON for all crew surfaces in the Claude-side Q&A ("keep the gate", 2026-08-06) | 2026-08-06 |
| R6 | v1 roles: owner/admin, office, installer, advertising; Manager tier designed but not provisioned | confirm / provision Manager now | confirm | RULED: confirmed | 2026-08-06 |
| R7 | Department membership model | single per employee v1 / multi-department now | single v1 | RULED: MULTI-DEPARTMENT NOW. An employee can belong to more than one department from day one. Membership union may expose non-sensitive navigation only; sensitive access requires explicit capability, current paid-work context, and resource scope. A secondary membership never bypasses the F4 clock gate. | 2026-08-06 |
| R8 | Pay math lives only in the quote tool; hub never duplicates payroll logic | confirm | confirm | RULED: confirmed | 2026-08-06 |

### Recorded consequences of R1 and R3 (so nobody rediscovers them mid-season)

**Historical only:** F1 voided the R1 sequencing/data-gap consequences, and F3
voided the GPS-primary consequences. Nothing in this subsection authorizes
implementation.

- The install season's first weeks run with NO per-job time capture. Shadow-mode
  P4P data starts when hub attendance and Route Mode land (Codex Phase 2,
  mid-season at best). The Claude-plan Phase 4 pay engine and the weekly
  economics ritual slide accordingly; a pay flip this install season is
  unlikely, takedown season or next year is the realistic window. Owner chose
  this knowingly to get advertising live first.
- The quote tool's independent pieces still ship on their own schedule:
  Phase 1 (budgeted hours + labor revenue + crew_members cache) and Phase 3
  (scheduling calendar) have no hub dependency.
- Under GPS-primary: the visit review/confirmation queue becomes a pay-critical
  path (approvals must happen before each weekly payroll), phone-lock and
  navigation-app gaps produce suggested visits needing human confirmation, and
  the bot/hub one-tap Arrived/Departed punches are the correction mechanism.
  Codex's own plan already treats low-evidence visits as suggestions requiring
  confirmation; that behavior is now load-bearing for pay.
- Copilot CRM cancellation re-anchors: after the quote tool calendar (Claude
  Phase 3) AND hub attendance are both live and clean for two weeks.

## Final rulings F1-F4 (Naldo, 2026-08-06 evening, supersede R1/R2/R3/R5 where stated)

| # | Decision | Ruling |
|---|---|---|
| F1 | Sequencing, supersedes R1 | RULED: PARALLEL TRACKS after joint Phase 0. Track A = quote tool labor/time/scheduling (Claude), targets Sept 21 with Telegram-bot-first capture into the canonical ledger. Track B = advertising PWA (Codex). Track C = hub office/install UI (Codex). Advertising no longer blocks time capture; R1's data-gap consequence is void. |
| F2 | Time ownership, supersedes R2 | RULED: QUOTE TOOL OWNS ALL CANONICAL TIME (day clock, breaks, job segments, travel) as one paid-day envelope. Hub = capture UI, offline command queue, raw GPS route evidence, read models. Matches both assistants' converged recommendation. |
| F3 | Pay-hours mechanism, supersedes R3 | RULED: MANUAL PRIMARY. One-tap Arrived/Departed punches are authoritative for pay from day one; GPS corroborates, flags mismatches, and may be promoted after Phase 5 field calibration. |
| F4 | Clock gate, refines R5 | RULED: SOFTENED GATE. Pre-clock-in: non-sensitive summary (date, start, crew, prep). Exact addresses, customer contact, route, and job actions unlock at accepted clock-in, server-enforced. Audited owner emergency override exists. |

## Enforcement notes from the compliance audit (2026-08-06, no new ruling needed)

- R6 stands: Codex's SPEC/MASTER describe a live Manager tier; final docs scope it
  back to designed-not-provisioned in v1. YLL has no managers.
- Wage-floor deferral stands: Codex's MASTER §8 gates Phase 2 reporting on a wage
  review; final docs move that requirement to where it always was, before the
  actual pay flip (attorney + payroll review), not before shadow reporting.
- R7 reconciliation: employees hold one or more department MEMBERSHIPS (Naldo's
  multi-department ruling); ONE ACTIVE department context per shift (Codex's
  routing model). Both satisfied.
- Silent items the final docs must state explicitly: 6-year wage-record retention
  figure, RLS before field launch, the written signed comp plan, the NY WTPA
  pay-rate notice on any hourly-to-P4P change, training bonus (+$4/hr) and
  referral bonus (season-1 IN per ruling), and A8's four non-negotiables
  consolidated into the contract section itself.

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
| Source of truth: Hub = employees, permissions, campaigns, Placement Runs, placements, hotspots, sign inventory, and raw route/device evidence. Quote Tool owns every canonical day-clock, break, job-segment, travel, approval, lock, and adjustment fact. This supersedes the earlier attendance/break/job-visit wording under F2. | RULED |
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

## Codex-side implementation decisions (reconciled from historical PR #35)

This table replaces the missing `CODEX-PLAN.md` reference. `OPEN` blocks only
the named feature or release gate; it does not block unrelated Phase 0 safety
work. `RULED` is authorized by the signed master plan or canonical contract.
`SUPERSEDED` is no longer a V1 decision.

| # | Decision | Status | Affected work |
|---|---|---|---|
| 1 | Door-hanger location terminology/privacy | PARTIALLY RULED: P16.5 fixes the residential privacy boundary and keeps pay OFF; only the door-hanger capture-unit terminology remains open | Track B door-hanger capture |
| 2 | Approver and pre-approval counting for placement accuracy worse than 20 m | OPEN | Track B review and pay-input acceptance |
| 3 | GPS retry duration and sample-freshness window | OPEN | Track B camera validation |
| 4 | Forgotten-run reconciliation at local midnight | RULED — closes at the last durable shutter; zero-photo run is abandoned/reviewed | Track B run recovery |
| 5 | Server-assigned offline Sign Number and capture-order differences | RULED — server assigns once per campaign; numbers are immutable and never reused | Track B placement persistence |
| 6 | Exact time-exception thresholds, overnight behavior, and locked-period handling | OPEN | Track A time contract / Track C exception UI |
| 7 | Installer GPS radius, sampling, multi-installer credit, and tracking gaps | OPEN | Later calibrated route evidence |
| 8 | Operational completion semantics | RULED in the canonical contract; departure behavior and installed trigger remain open | Track C completion |
| 9 | Telegram launch actions and group privacy | OPEN | Telegram hardening |
| 10 | Storage budget, backups, and indefinite placement-photo cost | OPEN | Phase 0 architecture / Track B release |
| 11 | Coworker current-location visibility beyond Naldo/Jason | OPEN — protective default is no | Track B/C maps |
| 12 | Unique-placement-spot clustering definition | OPEN | Later analytics |
| 13 | No-GPS behavior for time, offline, and desktop office punches | OPEN | Track A contract / Track C punch UI |
| 14 | Completion camera/gallery provenance and GPS requirements | OPEN — media itself is optional with at most three prompts | Track C completion media |
| 15 | Forgotten daily clock-out rule and reminder cadence | OPEN | Track A time / Track C reminders |
| 16 | Production SMS/OTP provider and recovery/support process | RULED 2026-08-15: invite-only Supabase Phone Auth delivered through Twilio Verify; Turnstile; Naldo/Jason-only recovery with no employee self-service; maximum 30-day remembered session; password identities revoked at activation with Supabase-console break-glass | Phase 0 identity |
| 17 | Versioned cross-repository contract | PARTIALLY COMPLETE: the normative Markdown mirror is byte-identical through `v1.4.0-draft`; JSON Schema/OpenAPI artifacts, authenticated cross-repository CI, and deploy-skew smoke remain open | Phase 0 contract gate |
| 18 | New-run connectivity, cached-session grace, and deactivated-device upload quarantine | RULED 2026-08-15: Placement Runs start online; an accepted run may capture offline for at most 12 hours; expired, deactivated, revoked, or otherwise ineligible-device uploads quarantine for Naldo/Jason review and never automatically count toward pay or inventory | Phase 0 auth/offline safety / Track B |
| 19 | Manager department-time behavior | SUPERSEDED for V1 — Manager tier is unprovisioned | Later Manager release |
| 20 | Advertising placement/photo visibility by employee, campaign, notes, coordinates, and history | RULED 2026-08-18: an employee sees exact coordinates, photos, notes, and history for their own placements; active employees may see team totals, approved campaign coverage, hotspots, and avoid zones only without another employee's exact route trail or private placement evidence; Naldo/Jason may see all exact placement evidence and route history. Residential door-hanger evidence remains governed by the separate protective rule. | Track B authorization/RLS |
| 21 | Forgotten-run anchor and zero-photo behavior | RULED by the signed master plan | Track B run recovery |
| 22 | Offline queue limits and pending-upload policy for uninstall, data clearing, account switch, and device replacement | OPEN | Phase 0 offline design / Track B release |
| 23 | Management classification | RULED 2026-08-15: Management is an Owner/Admin view and digest type, not an employee department membership or paid-work context | Phase 0 identity / navigation |
| 24 | Staging-only phone-auth implementation before shared-schema completion | RULED 2026-08-18: fail-closed phone-auth code and tests may proceed in a separate Vercel preview with a separate staging Supabase project; no field provisioning, paid workflow, or production phone-auth activation may proceed until the canonical schema/current-context, hosted identity/persona, provider, recovery, and revocation gates pass | Phase 0 staging identity |

## Open items owned by neither plan yet (PLAN-COMPARISON.md section 4)

Whole-day weather cancellation, vehicle cost, PTO/sick/holiday, worker
classification, physical paycheck delivery, customer reschedule notification,
new-hire onboarding checklist, off-season behavior.

## Added by the five-lens review (2026-08-06 night; details in FEATURE-BACKLOG.md)

| Decision | Options | Status |
|---|---|---|
| Advertising crew pay | piece rate / hourly / off-system | RULED 2026-08-06: PER-SIGN PIECE RATE, $2.50 per accepted placement, rate changeable as things go. Design consequence (NY law, min wage applies to piece-rate hourly averages): the ad crew joins the same day clock, and the QT pay engine computes signs x rate with a $17/hr floor true-up against hours, same machine as the installers. Accountant blesses the piece-rate wording with the comp plan. |
| Payroll vendor | QuickBooks / Gusto / CSV | RULED 2026-08-06: RAW CSV now, QuickBooks as a later-down-the-line plan. Payroll-day wizard (backlog #20) deferred until then; the CSV must still satisfy NY pay-stub content rules. |
| Digest model | one unified / per-department | RULED 2026-08-06: FOUR DIGESTS, one per department (office, advertising, install, management), each combining that department's ops AND attendance. Admins (Naldo, Jason) receive all four. The QT morning ops digest and the hub coaching digest fold into this model. |
| Sign inventory | counter only / full ledger | RULED 2026-08-06: IN SCOPE with the weekly-allocation model: stock on hand, weekly issuance of X signs per person (decrements stock), placements decrement the issued count, week-end reconciliation shows expected-back vs placed and feeds the piece-rate pay count. Hub owns the ledger (advertising domain); the QT pay engine consumes the weekly accepted-placement count per person. |
| Contract v1.1.0 amendments (design/load-list endpoint, takedown badge, sold_by + rep notification, missed-tap nudge, material fields pinned, deactivation final-pay, vocabulary/enums, DLQ alert, deploy smoke, shared schema, relay SLA, Flow F reserved) | applied to canonical + mirror | DONE; Codex acknowledged in the v1.3.0-draft mirror |
| Contract v1.2.0 amendments (Flow G advertising pay inputs, ad-crew day clock, piece-rate fields) | applied to canonical + mirror | DONE; Codex acknowledged in the v1.3.0-draft mirror |

## P16 configuration rulings (Naldo, 2026-08-07)

These rulings are copied from the merged Quote Tool canonical contract
`v1.3.0-draft` and govern the corresponding open items in
`CONTRACT-V1.3-PROPOSAL.md`.

| Item | Ruling |
|---|---|
| P16.5 — Door hangers | **PAY OFF.** No door-hanger pay unit is configured. Door-hanger placements never enter a pay count or an `AdvertisingWeekClosed` net count until a later ruling. The protective default lets the capturing employee see exact evidence only while local/pending/under review or inside the correction window; after verification, exact address/coordinates/photos are Naldo/Jason-only and employee maps aggregate/round them. Exact residential evidence is excluded from internal-public maps, leaderboards, and digests. Any door-hanger pay field stays null, and the engine treats a configured-null unit as “feature disabled,” never as zero-value work. |
| P16.6 — Completion media | **NOT REQUIRED; three prompts.** The completion command never blocks on `photo_refs[]`. The surface prompts at most three times, then completes without media. The same three-attempt cadence is the default for missed-tap nudges. Marked provisional by the owner. |
| P16.8 — Digests | All four types send at **08:00 America/New_York, daily**. Per-department recipients plus Naldo and Jason on all four. Delivery failures retry per contract P13/P15 and surface in the admin queue; escalation policy remains open. |
| P16.10 — Payroll CSV | **Generic vendor-neutral format for now.** One UTF-8 row per pay line, with a header and no provisional values. The canonical contract adds the required stable `pay_line_id` and defines the subtotal as `line_type = employee_subtotal` with blank quantity/unit/rate/reference fields and a deterministic ID. This completes the approved subtotal requirement without changing any pay amount. Vendor mapping and OT/blended-rate treatment remain open for the payroll professional; QuickBooks remains out of V1. |

Implementation guard: the paired v1.3 clarification defines the subtotal shape
and stable pay-line identity. Payroll CSV remains blocked only on its named open
vendor, overtime, and blended-rate decisions; no client may alter or calculate
pay independently.

## Final plan approval (Naldo, 2026-08-07)

Naldo approved `MASTER-PLAN 1.3-review-1` as the implementation plan and
authorized Phase 0 to begin after the merged canonical contract was mirrored
and byte-verified.
