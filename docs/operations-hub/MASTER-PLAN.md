# Yule Love Lights Operations Hub — MASTER PLAN (final)

> **Status:** FINAL, 2026-08-06, all owner rulings in (R1-R8 and F1-F4, see
> DECISIONS.md). Reviewed by five adversarial lenses on the Claude side, three
> on the Codex side, plus a compliance audit and a cross-document gap audit.
> Awaiting Naldo's approval line; on approval both source plans
> (CODEX-PLAN.md, CLAUDE-PLAN.md) become historical.
>
> **The governing trio.** This file states what is true across the system and
> where every detail lives:
> 1. **OPERATIONS-HUB-SPEC.md** — hub-side behavior authority (advertising,
>    camera, GPS, offline, PWA), as amended by section 6 below.
> 2. **OPERATIONS_HUB_CONTRACT.md** — integration authority, v1.0.0-draft,
>    canonical in `yll-quote-tool/docs/context/`, mirrored here as
>    INTEGRATION-CONTRACT.md. Endpoints, events, envelopes, ownership.
> 3. **DECISIONS.md** — the ruling log. Rulings beat everything.
> Quote-tool-side pay/scheduling detail: `yll-quote-tool/docs/context/
> project_p4p_labor.md` (with its 2026-08-06 addendum).

## 1. Mission

One operation, two applications. The Quote Tool is the business system of
record and the money engine. The Operations Hub (this repo, renamed from YLL
Call Copilot, at ops.yulelovelights.com) is the employee front door: office
tools, advertising field capture, installer day flow. The Hub must be faster
than SimpleCrew in the field, honest about browser limits, safe offline, and
incapable of producing a second payroll, job ledger, or pay number.

## 2. Ownership (final, ruling F2)

- **Quote Tool:** customers, jobs, addresses, schedule, assignments, budgeted
  hours, labor revenue, ALL canonical time (one paid-day envelope: day clock,
  breaks, job segments, travel), approvals/locks/adjustments, completion
  state + photo binaries, the P4P engine and payroll export, compensation
  config, the Telegram bot, shared-labor schema and `/api/ops/v1` (sole
  author: Quote Tool assistant).
- **Hub:** phone-OTP auth, employees/roles/department memberships, sessions,
  office/call tools, all advertising, raw route evidence, offline queues,
  read models, hub audit, hub schema (sole author: Codex).
- One immutable identity mapping: hub employee_id, QT crew_member, phone,
  Telegram id. Contract section 2.

## 3. Roles (rulings R6, R7)

Owner/admin (Naldo, Jason: identity, canonical time approval with Jason
primary, compensation, exports), office, installer, advertising. **Manager
tier is designed in schema but provisioned to NOBODY in v1** (R6; supersedes
the live-Manager description in the SPEC). **Department membership is
many-per-employee from day one** (R7) with one ACTIVE department context per
shift; multi-department employees get a switcher.

## 4. Time, the gate, and pay (rulings F2, F3, F4)

- All capture surfaces (Hub PWA, Telegram bot, office screens) submit
  commands; the Quote Tool's canonical ledger applies them: non-overlapping
  paid-day envelope, entry_kind segments, travel counted once,
  stoppage_reason from day one, midnight auto-close, append-only audit,
  six-year wage-record retention, exception queues. Contract sections 4-5.
- **Manual punches are authoritative for pay** (F3). GPS route evidence
  corroborates, flags mismatches, and may be promoted only after Phase 5
  calibration and an explicit owner decision.
- **Clock gate, softened** (F4): pre-clock-in a non-sensitive summary; exact
  addresses, contacts, routes, and job actions unlock at accepted clock-in,
  server-enforced, with an audited owner emergency override and the signed
  offline packet as the only exceptions.
- **The pay engine lives only in the Quote Tool** (R8): shadow mode first,
  per-person pay-mode flag as the rollback lever, integer cents, remainder
  to the crew, invoice-final pool basis, floor-true-up alarm, weekly period
  in America/New_York, hours paid current week, performance pay the
  following week after the 7-day quality window.
- **The display law** (binding, NY Labor Law 190/193 analysis in CLAUDE-PLAN
  A3): provisional performance pay renders exactly as `Pending quality
  review` everywhere, forfeiture is never a deduction, base pay is never
  touched, and only earned amounts reach payroll export. Season-1
  guardrails per ruling: yellow slips (with evidence and an employee
  response step), damage-as-yellow-slip, training bonus +$4/hr, referral
  bonus; profit sharing later. Before any individual's pay flips: signed
  comp plan (attorney-reviewed) and an NY WTPA pay-rate notice in their
  primary language.

## 5. Delivery (ruling F1: parallel tracks)

**Phase 0, joint:** the contract as OpenAPI stubs, identity mapping, auth/
audit/idempotency scaffolding, kill switches, production-route security
audit, PWA cache policy, AGENTS.md ownership rows for both assistants.

Then three tracks in parallel:

- **Track A, Quote Tool (Claude):** `crew_members`, budgeted hours + labor
  revenue from design geometry (seed-rates session with Jason is the gating
  input), the canonical time ledger + Telegram-bot-first capture **targeting
  Sept 21**, the scheduling calendar (Copilot Zapier feed #84 retires),
  approvals/exception surfaces, P4P shadow engine, earnings/stats APIs.
- **Track B, Hub advertising (Codex):** campaigns, Placement Runs, Camera
  Mode, GPS policy, offline queue, numbering/stamping, feed/map/export,
  hotspots. Per the SPEC.
- **Track C, Hub office/install UI (Codex):** rename/preserve Call Copilot,
  OTP auth + RLS + fail-closed middleware, day-clock and punch UI calling
  Flow B, gate summary screens, manual Arrived/Departed, completion UI,
  reporting. Foreground dwell suggestions are Phase 5, after calibration.

Actual P4P pay enablement is last, feature-flagged, and gated on the
professional reviews. External Copilot CRM (Homeworks) cancels only after
schedule/time parity plus two clean weeks and a check that nobody uses its
reports/QuickBooks/portal; YLL Call Copilot the codebase is preserved.

## 6. Deltas over the SPEC (the SPEC is authoritative EXCEPT these)

1. Manager tier not provisioned in v1 (R6).
2. Department memberships many-per-employee, one active context (R7).
3. Wage-floor review stays deferred per Naldo's explicit ruling; the
   attorney/payroll review gates the PAY FLIP, not Phase 2 shadow reporting.
4. Six-year retention stated explicitly for wage-feeding records.
5. RLS-before-field-launch stated explicitly for the Hub.
6. Completion state names locked: `field_work_completed`,
   `completion_submitted_for_office_review` (from CODEX-PLAN section 19).
7. Training and referral bonuses are in scope season 1 (ruled), carried in
   the earnings payload.
8. Sept 21 Track A target restored (F1); "advertising first" now means
   parallel, not blocking.

## 7. Open items

All live in DECISIONS.md: Codex's device-calibration and privacy items
(section 29 of its plan), the neither-plan gaps (whole-day weather
cancellation, vehicle costs, PTO, W-2/1099, paycheck delivery mechanics,
customer reschedule notification, onboarding checklist, off-season), the
Claude-side product opens (weather pay rule, success metrics, labor %
starting dial, takedown date), and the professional reviews (attorney on the
comp plan, payroll provider on OT regular-rate and pay-stub fields). A
blocker disables only its feature; nothing undecided about wages, privacy,
surveillance, or permissions turns on silently.

## 8. Approval

- [ ] Codex confirms the mirror matches and the SPEC deltas in section 6.
- [ ] Naldo approves; MASTER-PLAN.md becomes authoritative; source plans
      marked historical.
