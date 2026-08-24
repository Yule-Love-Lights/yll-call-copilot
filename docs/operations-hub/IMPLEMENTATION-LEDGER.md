# Operations Hub implementation ledger

As of `master@cf2595b75b08df937cc2e3ee2ed749bf8c589bdb` on 2026-08-24.

This is the working inventory of approved Operations Hub ideas and their
current implementation evidence. It is a planning and release-audit aid, not
authority to bypass the canonical contract, RLS, product order, or production
authorization rules. When this ledger conflicts with the canonical contract
or the reconciled planning pack, those sources control.

## Status key

- **Shipped**: merged into `master` with named implementation evidence.
- **Partial**: a safe foundation exists, but the promised workflow is not ready.
- **Blocked**: waiting for an owner decision, another repository, access proof,
  or a required release gate.
- **Not started**: no product implementation is present in this repository.
- **Open PR**: proposed work, not part of the shipped product.
- **Later**: approved future candidate, not current V1 work.

## Session updates

| Date | Update | Evidence / next state |
| --- | --- | --- |
| 2026-08-24 | Created this ledger from the archived Office-task and Operations Hub closeout. | Audited `master@cf2595b75b08df937cc2e3ee2ed749bf8c589bdb`, current source-of-truth documents, code, migrations, tests, merged PRs, and open PRs. PR #81 merged during the audit and is reflected below. Future wraps must append a dated row, including an explicit no-status-change row when applicable. |

## Current release snapshot

| Area | Status | Evidence | Next action / constraint |
| --- | --- | --- | --- |
| Product order | **Shipped policy** | `MASTER-PLAN.md` §13; `AGENTS.md` | Keep delivery order Management, Office, Advertising, Installer. Do not provision Advertising or Installer users early. |
| Operations Hub ownership boundary | **Shipped policy** | `AGENTS.md`; `MASTER-PLAN.md` §§1–3; `INTEGRATION-CONTRACT.md` | Hub owns UI, Hub auth, campaigns, placements, media, map zones, inventory, and Hub tasks. |
| Quote Tool ownership boundary | **Shipped policy** | `AGENTS.md`; `MASTER-PLAN.md` §3 | Quote Tool owns quotes, job facts, canonical time, pay, payroll, `/api/ops/v1`, and customer/job lifecycle facts. Hub must not recreate them. |
| Contract/schema mirror and pin | **Shipped** | `INTEGRATION-CONTRACT.md`; `contract-pin.json`; `ops-contract-schema/`; `scripts/verify-operations-contract.mjs`; PR #70 | Keep the mirror byte-identical and require authenticated cross-repository CI. |
| Trusted cross-repository byte CI | **Shipped** | `.github/workflows/`; `README.md` Phase 0 state | Runtime version-health and live deploy-skew proof remain **Blocked**. |
| Default-deny database posture | **Shipped foundation** | `PHASE-0-RLS-RUNBOOK.md`; `supabase/tests/database/default_deny_rls.test.sql`; Hub CI database-security job | Hosted real-token and semantic-persona proof remain **Blocked**. |
| Production deployment safety | **Partial** | `.env.example`; `scripts/verify-auth-runtime-config.mjs`; `vercel.json`; PRs #74–#80 | Production migration and post-apply proof are not authorized. |

## Management and Office

| Requirement / idea | Status | Evidence | Next action / constraint |
| --- | --- | --- | --- |
| Owner/admin Management mode | **Partial** | `src/app/management/ManagementShell.tsx`; `src/app/page.tsx`; PR #62 | The shell and owner routing exist. The full owner view in `MASTER-PLAN.md` §9 needs later department facts, review queues, inventory, and canonical projections. |
| Owner shortcut to Office dashboard | **Shipped** | `src/app/office/page.tsx`; `src/app/management/ManagementShell.tsx`; PR #81 | Owners can open the protected Office dashboard without changing their Management landing mode. |
| Office shell, call coaching, calls, transcripts, scorecards, and trends | **Shipped / existing product** | `src/app/page.tsx`; `src/app/coach/`; `src/app/scoreboard/`; `MASTER-PLAN.md` §8 | Keep existing surfaces behind the current authorization and metric-provenance rules. |
| Office workday / canonical time display | **Blocked intentionally** | `src/app/OfficeWorkdayCard.tsx`; `MASTER-PLAN.md` §§4, 8; `PHASE-0-AUTHORIZATION-INVENTORY.md` §5 | Quote Tool must ship the authorized current-context/time runtime. Hub must not build a second time, break, travel, or pay ledger. |
| Real quote timing, workload, promises, and quote-origin task view | **Blocked intentionally** | `src/app/OfficeQuoteAndTasksCard.tsx`; `QUOTE-LIFECYCLE-TASK-INTEGRATION-REQUIREMENTS.md` | Show an explicit unavailable state until the corrected canonical schema and Quote Tool producer/runtime exist. |
| Manual Hub task creation and task list | **Shipped** | `src/app/OfficeTasksCard.tsx`; `src/app/api/tasks/route.ts`; PR #68 | Hub-owned manual tasks only. No automatic Quote Tool or call projections yet. |
| Default task due time within 24 hours | **Shipped** | `supabase/migrations/20260821141530_office_tasks.sql`; `supabase/tests/database/office_tasks.test.sql` | Preserve the database default and test. |
| Open and blocked task view | **Shipped** | `OfficeTasksCard.tsx` (`VisibleTaskStatus`); `api/tasks/route.ts`; UI tests | Completed and dismissed tasks remain terminal and do not appear in the active list. |
| Complete, block, and dismiss controls | **Shipped** | `OfficeTasksCard.tsx`; `api/tasks/[id]/route.ts`; route/UI tests | Block and dismiss require a reason. |
| Accessible mobile/desktop task UI and honest failures | **Shipped foundation** | `OfficeTasksCard.tsx`; `OfficeTasksCard.test.tsx` | Maintain visible loading, retry, unavailable/error, aria-live/alert, and disabled-pending behavior in future changes. |
| Duplicate-click and retry protection | **Shipped** | `OfficeTasksCard.tsx`; `taskRequest.ts`; task RPCs and pgTAP tests | Every new mutation must carry an idempotency key. |
| Task creator-or-assignee ownership | **Shipped** | `ops_update_own_task` in `20260821141530_office_tasks.sql`; `office_tasks.test.sql` | Ownership/provenance are immutable. Do not add guessed assignment. |
| Immutable task audit events | **Shipped** | `ops_task_events`; `reject_ops_task_event_mutation`; pgTAP tests | Preserve append-only audit behavior. |
| Task RLS/default deny and source-event uniqueness | **Shipped** | Office task migration and pgTAP tests | `(source_system, source_event_id)` is reserved for a future trusted projection. It is not permission to create one now. |
| Customer sending from task work | **Not started by design** | `AGENTS.md`; `QUOTE-LIFECYCLE-TASK-INTEGRATION-REQUIREMENTS.md` | Keep customer sending outside Hub tasks unless separately approved through Quote Tool. |

## Quote Tool lifecycle, events, time, and pay

| Requirement / idea | Status | Evidence | Next action / constraint |
| --- | --- | --- | --- |
| Corrected canonical Quote lifecycle schema | **Blocked** | `QUOTE-LIFECYCLE-TASK-INTEGRATION-REQUIREMENTS.md` §§1–2 | Quote Tool must correct request/quote identifiers, event-specific payloads, entity versioning, and the missing `office.tasks.work` capability before activation. |
| Durable quote requests, assignment history, first-send fact, revisions, waits, promises | **Blocked** | `QUOTE-LIFECYCLE-TASK-INTEGRATION-REQUIREMENTS.md` §§3–4 | Build in Quote Tool with governed employee identity and no guessed source links. |
| Authenticated cursor event feed, outbox, acknowledgement, replay, kill switch, DLQ | **Blocked** | `QUOTE-LIFECYCLE-TASK-INTEGRATION-REQUIREMENTS.md` §5 | Quote Tool must implement and test retention, ordering, duplicate/out-of-order handling, acknowledgement, reconciliation, and DLQ policy. |
| Hub durable event inbox and quote-origin task projection | **Not started** | Closed PR #73; `QUOTE-LIFECYCLE-TASK-INTEGRATION-REQUIREMENTS.md` §§5–6 | Do not resume until the corrective contract and Quote Tool producer/runtime are merged and proven. |
| Active quoting time and conversion metrics | **Blocked decision** | `QUOTE-LIFECYCLE-TASK-INTEGRATION-REQUIREMENTS.md` §4 | Naldo must rule the inactivity cap, included change domains, manual sends, and conversion definitions. Never use typing, browser presence, or inferred activity. |
| Canonical time, breaks, travel, schedules, compensation, payroll, and pay display | **Quote Tool-owned, Hub not started by design** | `MASTER-PLAN.md` §§3–5, 10; `AGENTS.md` | Hub may present authorized canonical facts later but must never calculate or duplicate them. |
| Seven-day quality-window protection | **Shipped policy / unimplemented field presentation** | `MASTER-PLAN.md` §10; `FEATURE-BACKLOG.md` | Any future UI, digest, leaderboard, or export must say “Pending quality review” and exclude unearned amounts. |

## Identity, authorization, and live calling

| Requirement / idea | Status | Evidence | Next action / constraint |
| --- | --- | --- | --- |
| Immutable Hub employees, memberships, Auth links, and identity audit | **Shipped foundation** | `supabase/migrations/0023_operations_hub_identity_foundation.sql`; `identity_foundation.test.sql`; PR #50 | Hosted persona and real-token proof remain **Blocked**. |
| Shared Quote Tool email/password identity bridge | **Partial** | `supabase/migrations/0025_quote_tool_identity_bridge.sql`; `SHARED-QUOTE-IDENTITY-ROLLOUT.md`; PR #64 | Staging sign-in is verified. Production activation, replacement/revocation, and source-aware mutation checks remain **Blocked**. |
| Invite-only email/password login | **Shipped** | `FEATURE-BACKLOG.md`; `MASTER-PLAN.md` §4 | Keep active while the phone path remains disabled. |
| Phone/OTP, Turnstile, Twilio Verify, recovery, reassignment, and password revocation | **Partial and deferred** | `src/lib/auth/phoneAuth.ts`; `PHASE-0-CHECKLIST.md`; `MASTER-PLAN.md` §4 | Preview-only/fail-closed code exists. Provider activation, phone identities, recovery, reassignment, and revocation need a later owner decision and dedicated proof. |
| Manager capability | **Designed/tested, unprovisioned** | `FEATURE-BACKLOG.md`; `MASTER-PLAN.md` §4 | Only Naldo and Jason are owner/admin in V1. |
| Resource-scoped Office lead/call work | **Shipped foundation** | `supabase/migrations/0020_lead_work_authorization.sql`; `lead_work_authorization.test.sql`; PR #46 | Maintain customer permission and metric-provenance controls. |
| Customer live calling | **Blocked intentionally** | `LIVE-CALLING-ACTIVATION-BLOCKERS.md`; `scripts/live-bridge.mjs`; PR #69 | Do not enable until every provider, media, ordering, retry, recovery, and smoke gate passes with explicit activation approval. |

## Advertising and Installer

| Requirement / idea | Status | Evidence | Next action / constraint |
| --- | --- | --- | --- |
| Advertising home, campaigns, Placement Runs, Camera Mode, offline queue | **Not started** | `MASTER-PLAN.md` §6; no Advertising route/module/migration in current application inventory | Begin only after the product order and Phase 0 authorization/RLS gates allow it. |
| Placement media, GPS labeling, maps, hotspots, avoid zones, review queue | **Not started** | `MASTER-PLAN.md` §6; `FEATURE-BACKLOG.md` | Need real-device PWA design, evidence lifecycle, privacy constraints, and hosted personas. |
| Sign inventory ledger, allocations, reconciliation, atomic sign numbering | **Not started** | `MASTER-PLAN.md` §6; `FEATURE-BACKLOG.md` | Hub-owned ledger only. Quote Tool may consume acknowledged accepted-placement counts, never Hub-calculated pay. |
| Advertising piece rate/floor true-up | **Quote Tool-owned, not activated** | `FEATURE-BACKLOG.md`; `MASTER-PLAN.md` §6, §10 | $2.50 / $17 floor rules are planning facts, not a Hub money feature. Separate professional and owner gates apply. |
| Advertising Telegram deep link and commands | **Not started** | `MASTER-PLAN.md` §11 | Quote Tool owns the bot/webhook. A Telegram photo cannot become a verified placement. |
| Installer schedule, job facts, routes, Arrived/Departed, completion | **Not started** | `MASTER-PLAN.md` §7; no Installer route/module/migration in current application inventory | Requires Quote Tool schedule/job/context runtime, permissions, field UI, retry/reconciliation, hosted personas, and device pilot. |
| Installer completion media and materials workflow | **Partially ruled, not started** | `FEATURE-BACKLOG.md`; `MASTER-PLAN.md` §7 | Media is optional with at most three prompts. Provenance, GPS, and installed trigger still need decisions. |
| Advertising/Installer provisioning | **Blocked** | `AGENTS.md`; `PHASE-0-CHECKLIST.md` | No accounts until authorization, RLS, identity, device/offline, and paid-work gates pass. |

## Digests, reporting, and later candidates

| Requirement / idea | Status | Evidence | Next action / constraint |
| --- | --- | --- | --- |
| Four department/Management digests | **Partial** | Existing digest routes under `src/app/api/digest/`; `MASTER-PLAN.md` §11; `FEATURE-BACKLOG.md` | Daily timing and Naldo/Jason receipt are ruled. Department recipient selection and escalation remain owner decisions; future facts must obey privacy and quality-window rules. |
| Owner reporting, leaderboards, and personal statistics | **Partial** | Existing dashboard, scorecard, analytics, and digest routes; `MASTER-PLAN.md` §§8–10 | New metrics require stable employee identity, canonical provenance, exact definitions, privacy checks, and no premature pay display. |
| Payroll CSV / QuickBooks | **Blocked / Later** | `FEATURE-BACKLOG.md`; `MASTER-PLAN.md` §10 | Quote Tool owns payroll. V1 raw CSV awaits outstanding payroll decisions; QuickBooks is later. |
| Door hangers | **Partially ruled** | `FEATURE-BACKLOG.md` | Pay is off. Capture unit and residential privacy/visibility rules remain open. |
| Sign removal, attribution, vehicle/tools, onboarding, forecasting, route optimization, accessibility camera controls, seasonal retrospective | **Later** | `FEATURE-BACKLOG.md` | Do not treat as committed implementation work. |

## Migration and production-release ledger

| Requirement / idea | Status | Evidence | Next action / constraint |
| --- | --- | --- | --- |
| Production migration 0019 | **Shipped out of band** | `README.md` Phase 0 state; hosted migration runbook | It was verified against the existing production public-table state. |
| Production-shaped staging rehearsal for 0020–0024 | **Shipped staging proof** | `HOSTED-MIGRATION-0017-0024-RUNBOOK.md`; `README.md` Phase 0 state; PR #60 | Staging proof does not authorize a production write. |
| Production migrations 0020–0024 | **Blocked, no production write authorized** | `PRODUCTION-0020-0024-NO-BACKUP-PLAN.md`; PRs #74–#80 | Use only the owner-selected no-backup dashboard driver after its exact read-only preflight and a new exact-parameter authorization. |
| Production 0025 identity bridge and Office-task migration | **Deferred separately** | `README.md` Phase 0 state; `PRODUCTION-0020-0024-NO-BACKUP-PLAN.md` | The current production packet explicitly excludes both migrations. |
| Historical artifacts and migration reconciliation | **Partial / blocked production action** | `HOSTED-MIGRATION-0017-0024-RUNBOOK.md`; dashboard driver PRs #78–#80 | Keep the approved aggregate reconciliation and private mapping inputs out of source control and chat. Do not fabricate backfill. |
| Local database proof | **Environment-dependent** | Hub CI database-security job; `supabase/tests/database/` | Run locally only with Docker Desktop available. CI proof is not permission to write staging or production. |

## Open pull requests at this snapshot

| PR | Status | Ledger disposition |
| --- | --- | --- |
| #66, sales script kit | **Open PR** | Predates this Operations Hub audit. Treat as separate documentation scope. |
| #59, staging auth deploy gate | **Draft** | Historical/deferred phone-auth work. Do not resume until the phone-auth activation decision and Phase 0 blockers are resolved. |

## Priority queue for the next session

1. **Repair the Quote Tool Flow Q contract/schema contradictions**, then implement its governed lifecycle producer, capability snapshot, current-context read, and event feed in Quote Tool. Mirror the corrected bytes in Hub only after the canonical merge.
2. **Complete hosted persona and real-token authorization proof** without provisioning field users or enabling phone auth.
3. **Complete the no-backup production 0020–0024 preflight** and stop for the separately required exact-parameter production authorization. Keep 0025 and Office tasks out of that operation.
4. **Run local Supabase proof when Docker Desktop is available** and refresh the local Quote Tool checkout before local cross-repository verification.
5. **Start Advertising only after the preceding gates permit it**, beginning with campaigns/Placement Runs and the offline-camera evidence design. Installer work follows Advertising.

## Guardrails that apply to every future item

- No customer sending, Quote Tool fact projection, task automation, time/pay
  ledger, guessed employee attribution, or fabricated historical backfill.
- No Advertising or Installer account provisioning before the Phase 0 release
  stop is cleared.
- No production database write, provider activation, cron activation, or live
  calling without its own narrow authorization and post-action proof.
- Every mutation needs authorization, idempotency, immutable audit evidence,
  and a positive test of the allowed path.
- Every cross-repository change starts in Quote Tool when it changes a canonical
  fact or contract, then is mirrored here byte-for-byte.
