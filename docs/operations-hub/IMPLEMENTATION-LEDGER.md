# Operations Hub implementation ledger

As of `master@c5c5857f034567a7e55b833589400ea5a1d493f6` on 2026-08-25.

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
- **Superseded**: replaced, closed, duplicate, or expressly removed from the
  current Hub plan.

## Session updates

| Date | Update | Owner | Evidence / next state |
| --- | --- | --- | --- |
| 2026-08-24 | Created this ledger from the archived Office-task and Operations Hub closeout. | Hub | Audited `master@cf2595b75b08df937cc2e3ee2ed749bf8c589bdb`, current source-of-truth documents, code, migrations, tests, merged PRs, and open PRs. PR #81 merged during the audit and is reflected below. Future wraps must append a dated row, including an explicit no-status-change row when applicable. |
| 2026-08-24 | Applied and verified the owner-authorized no-backup production 0020–0024 rollout, then repaired migration history. | owner decision | Production has canonical history `0001`–`0024`, post-0024 assertions, and a matching staged structural-schema fingerprint. The 28 scoped derived artifacts were permanently removed without backup. `0025` and Office Tasks remain deferred. |
| 2026-08-24 | Re-audited the archived-session inventory against current `master`; added missing evidence-backed items and recorded unmerged PRs without treating them as shipped. | Hub | `master@82df971d93a3c7665641a4d35ef8bebbc83e5dd0`; retain production proof from PR #83 and keep 0025, Office Tasks, provider activation, customer sends, and cron separately authorized. |
| 2026-08-25 | Reconciled the Flow Q and documentation-PR snapshot without changing any runtime or release state. | both | Current Hub `master@3eafc0d4a796367c9a5df4d3fa4496aeaa8e9c89` and Quote Tool `master@5ca62eb8f4fda1c83b4c73884d21c9e6b11d3ae1` still pin Flow Q `v1.5.0-draft` / `1.1.0-draft`. Quote Tool PR #881 remains a draft at `8fc5ec089d11d00c93ac6d10dfa27b92e98a6e41`; Hub PRs #84 and #85 were closed as obsolete documentation work. |
| 2026-08-25 | Merged a production-only Office Tasks migration runner and runbook; no hosted preflight or write ran in that PR. | Hub | PR #89 merged as `master@c5c5857f034567a7e55b833589400ea5a1d493f6`; it verifies the exact Office Tasks migration, refuses staging, and requires a separate protected operator environment and exact production-write authorization. |
| 2026-08-25 | Performed a read-only production Office Tasks audit and corrected the runner's production-history prerequisite. | Hub | Production history has canonical `0001`–`0024` plus `20260825130719_quote_tool_identity_bridge` and `20260825130728_production_quote_tool_identity_activation`; `ops_tasks`, `ops_task_events`, and both task RPCs are absent. The original PR #89 runner rejected that valid history before any write. This audit changes only the runner/runbook/tests to require the exact observed identity records; Office Tasks remains unavailable and separately authorized. |

## Current release snapshot

| Area | Status | Owner | Evidence | Next action / constraint |
| --- | --- | --- | --- | --- |
| Product order | **Partial** | owner decision | `MASTER-PLAN.md` §13; `AGENTS.md` | The approved order is Management, Office, Advertising, Installer. Do not provision Advertising or Installer users early. |
| Operations Hub ownership boundary | **Partial** | Hub | `AGENTS.md`; `MASTER-PLAN.md` §§1–3; `INTEGRATION-CONTRACT.md` | Hub owns UI, Hub auth, campaigns, placements, media, map zones, inventory, and Hub tasks. |
| Quote Tool ownership boundary | **Partial** | Quote Tool | `AGENTS.md`; `MASTER-PLAN.md` §3 | Quote Tool owns quotes, job facts, canonical time, pay, payroll, `/api/ops/v1`, and customer/job lifecycle facts. Hub must not recreate them. |
| Contract/schema mirror and pin | **Shipped** | both | `INTEGRATION-CONTRACT.md`; `contract-pin.json`; `ops-contract-schema/`; `scripts/verify-operations-contract.mjs`; PR #70 | Keep the mirror byte-identical and require authenticated cross-repository CI. |
| Trusted cross-repository byte CI | **Shipped** | both | `.github/workflows/`; `README.md` Phase 0 state | Runtime version-health and live deploy-skew proof remain blocked. |
| Default-deny database posture | **Shipped** | Hub | `PHASE-0-RLS-RUNBOOK.md`; `supabase/tests/database/default_deny_rls.test.sql`; Hub CI database-security job | Hosted real-token and semantic-persona proof remain blocked. |
| Production deployment safety | **Partial** | owner decision | `.env.example`; `scripts/verify-auth-runtime-config.mjs`; `vercel.json`; PRs #74–#83 and #88; production post-apply proof | The owner-authorized 0020–0024 rollout, shared-credentials bridge, and identity activation are complete. Keep Office Tasks, live calling, sends, and cron activation separately authorized. |

## Management and Office

| Requirement / idea | Status | Owner | Evidence | Next action / constraint |
| --- | --- | --- | --- | --- |
| Owner/admin Management mode | **Partial** | Hub | `src/app/management/ManagementShell.tsx`; `src/app/page.tsx`; PR #62 | The shell and owner routing exist. The full owner view in `MASTER-PLAN.md` §9 needs later department facts, review queues, inventory, and canonical projections. |
| Owner shortcut to Office dashboard | **Shipped** | Hub | `src/app/office/page.tsx`; `src/app/management/ManagementShell.tsx`; PR #81 | Owners can open the protected Office dashboard without changing their Management landing mode. |
| Office shell, call coaching, calls, transcripts, scorecards, and trends | **Shipped** | Hub | `src/app/page.tsx`; `src/app/coach/`; `src/app/scoreboard/`; `MASTER-PLAN.md` §8 | Keep existing surfaces behind the current authorization and metric-provenance rules. |
| Office workday / canonical time display | **Blocked** | both | `src/app/OfficeWorkdayCard.tsx`; `MASTER-PLAN.md` §§4, 8; `PHASE-0-AUTHORIZATION-INVENTORY.md` §5 | Quote Tool must ship the authorized current-context/time runtime. Hub must not build a second time, break, travel, or pay ledger. |
| Real quote timing, workload, promises, and quote-origin task view | **Blocked** | both | `src/app/OfficeQuoteAndTasksCard.tsx`; `QUOTE-LIFECYCLE-TASK-INTEGRATION-REQUIREMENTS.md` | Show an explicit unavailable state until the corrected canonical schema and Quote Tool producer/runtime exist. |
| Manual Hub task creation and task list | **Partial** | Hub | `src/app/OfficeTasksCard.tsx`; `src/app/api/tasks/route.ts`; PR #68 | UI, routes, and tests are merged, but production lacks `20260821141530_office_tasks.sql`; the card must remain unavailable until a separate rollout. |
| Default task due time within 24 hours | **Partial** | Hub | `supabase/migrations/20260821141530_office_tasks.sql`; `supabase/tests/database/office_tasks.test.sql` | The migration is deferred in production. Preserve the default and test for its later specific rollout. |
| Open and blocked task view | **Partial** | Hub | `OfficeTasksCard.tsx` (`VisibleTaskStatus`); `api/tasks/route.ts`; UI tests | The active-list behavior is implemented but unavailable in production until the Office Tasks migration is applied. |
| Complete, block, and dismiss controls | **Partial** | Hub | `OfficeTasksCard.tsx`; `api/tasks/[id]/route.ts`; route/UI tests | The controls are implemented and block/dismiss require a reason, but production schema work remains deferred. |
| Accessible mobile/desktop task UI and honest failures | **Partial** | Hub | `OfficeTasksCard.tsx`; `OfficeTasksCard.test.tsx` | The unavailable state is currently correct in production; retain loading, retry, error, aria-live/alert, and disabled-pending behavior for activation. |
| Duplicate-click and retry protection | **Partial** | Hub | `OfficeTasksCard.tsx`; `taskRequest.ts`; task RPCs and pgTAP tests | The implementation carries idempotency keys; it awaits the deferred production migration. |
| Task creator-or-assignee ownership | **Partial** | Hub | `ops_update_own_task` in `20260821141530_office_tasks.sql`; `office_tasks.test.sql` | Ownership/provenance rules are implemented but not yet present in production. |
| Immutable task audit events | **Partial** | Hub | `ops_task_events`; `reject_ops_task_event_mutation`; pgTAP tests | Append-only behavior is implemented but awaits the deferred migration. |
| Task RLS/default deny and source-event uniqueness | **Partial** | Hub | Office task migration and pgTAP tests | The production schema does not yet contain these guards. `(source_system, source_event_id)` remains reserved for a future trusted projection. |
| Customer sending from task work | **Not started** | Quote Tool | `AGENTS.md`; `QUOTE-LIFECYCLE-TASK-INTEGRATION-REQUIREMENTS.md` | Keep customer sending outside Hub tasks unless separately approved through Quote Tool. |
| Recording sync, performance-only metrics, and durable call-commitment extraction | **Partial** | Hub | `src/app/api/cron/sync-recordings/route.ts`; `src/app/api/cron/extract-commitments/route.ts`; `supabase/migrations/0024_commitment_extraction_tracking.sql`; `supabase/tests/migration/0024_commitment_extraction_tracking.test.sql` | Keep scheduled extraction disabled until its separate cron activation proof. Only `metric_scope = 'performance'` may contribute to coaching, commitments, or reporting. |
| HighLevel follow-up, Second Mile sends, and scheduled Hub work | **Blocked** | owner decision | `src/app/api/followups/[id]/send/route.ts`; `src/app/api/second-mile/[id]/send/route.ts`; six routes under `src/app/api/cron/`; `scripts/verify-auth-runtime-config.mjs` | Complete recipient refresh and uncertain-delivery reconciliation, then obtain narrow activation approval and deployed provider proof. No customer send or cron activation while `GHL_FOLLOWUP_SEND_ENABLED`, `GHL_SEND_ENABLED`, or `CRON_ENABLED` is fail-closed. |

## Quote Tool lifecycle, events, time, and pay

| Requirement / idea | Status | Owner | Evidence | Next action / constraint |
| --- | --- | --- | --- | --- |
| Corrected canonical Quote lifecycle schema | **Blocked** | both | `QUOTE-LIFECYCLE-TASK-INTEGRATION-REQUIREMENTS.md` §§1–2 | Quote Tool must correct request/quote identifiers, event-specific payloads, entity versioning, and the missing `office.tasks.work` capability before activation. |
| Durable quote requests, assignment history, first-send fact, revisions, waits, promises | **Blocked** | Quote Tool | `QUOTE-LIFECYCLE-TASK-INTEGRATION-REQUIREMENTS.md` §§3–4 | Build in Quote Tool with governed employee identity and no guessed source links. |
| Authenticated cursor event feed, outbox, acknowledgement, replay, kill switch, DLQ | **Open PR** | Quote Tool | Quote Tool PR #881 remains a draft at `8fc5ec089d11d00c93ac6d10dfa27b92e98a6e41`; current Quote Tool `master@5ca62eb8f4fda1c83b4c73884d21c9e6b11d3ae1` has no `quote-events`, `paid-contexts/current`, or authorization-snapshot route. | Repair the canonical schema first, then complete and prove PR #881's retention, ordering, duplicate/out-of-order, acknowledgement, reconciliation, kill-switch, and DLQ behavior before a Hub consumer is resumed. |
| Hub durable event inbox and quote-origin task projection | **Not started** | Hub | Closed PR #73; `QUOTE-LIFECYCLE-TASK-INTEGRATION-REQUIREMENTS.md` §§5–6 | Do not resume until the corrective contract and Quote Tool producer/runtime are merged and proven. |
| Active quoting time and conversion metrics | **Blocked** | owner decision | `QUOTE-LIFECYCLE-TASK-INTEGRATION-REQUIREMENTS.md` §4 | Naldo must rule the inactivity cap, included change domains, manual sends, and conversion definitions. Never use typing, browser presence, or inferred activity. |
| Canonical time, breaks, travel, schedules, compensation, payroll, and pay display | **Not started** | Quote Tool | `MASTER-PLAN.md` §§3–5, 10; `AGENTS.md` | Hub may present authorized canonical facts later but must never calculate or duplicate them. |
| Seven-day quality-window protection | **Partial** | owner decision | `MASTER-PLAN.md` §10; `FEATURE-BACKLOG.md` | Any future UI, digest, leaderboard, or export must say “Pending quality review” and exclude unearned amounts. |

## Identity, authorization, and live calling

| Requirement / idea | Status | Owner | Evidence | Next action / constraint |
| --- | --- | --- | --- | --- |
| Immutable Hub employees, memberships, Auth links, and identity audit | **Shipped** | Hub | `supabase/migrations/0023_operations_hub_identity_foundation.sql`; `identity_foundation.test.sql`; PR #50 | Hosted persona and real-token proof remain blocked. |
| Shared Quote Tool email/password identity bridge | **Partial** | both | `supabase/migrations/0025_quote_tool_identity_bridge.sql`; `supabase/migrations/20260825120136_production_quote_tool_identity_activation.sql`; `SHARED-QUOTE-IDENTITY-ROLLOUT.md`; PRs #64 and #88 | Production sign-in is verified for existing approved Office/Owner/Admin identities. Replacement/revocation and source-aware mutation checks remain blocked; do not link Advertising or Installer identities. |
| Invite-only email/password login | **Shipped** | Hub | `FEATURE-BACKLOG.md`; `MASTER-PLAN.md` §4 | Keep active while the phone path remains disabled. |
| Phone/OTP, Cloudflare Turnstile, Twilio Verify, recovery, reassignment, and password revocation | **Partial** | owner decision | `src/lib/auth/phoneAuth.ts`; `PHASE-0-CHECKLIST.md`; `MASTER-PLAN.md` §4 | Preview-only/fail-closed code exists. Provider activation, phone identities, recovery, reassignment, and revocation need a later owner decision and dedicated proof. |
| Manager capability | **Partial** | owner decision | `FEATURE-BACKLOG.md`; `MASTER-PLAN.md` §4 | Only Naldo and Jason are owner/admin in V1. |
| Resource-scoped Office lead/call work and CRM contact safety | **Shipped** | Hub | `supabase/migrations/0020_lead_work_authorization.sql`; `lead_work_authorization.test.sql`; `src/lib/leads/scoring.test.ts`; `src/lib/leads/queue.test.ts`; PR #46 | Recheck current customer permission, recipient, channel DND, tags, and stage before any new customer work. Never attribute training data to performance. |
| Customer live calling | **Blocked** | owner decision | `LIVE-CALLING-ACTIVATION-BLOCKERS.md`; `scripts/live-bridge.mjs`; PR #69 | Do not enable until every provider, media, ordering, retry, recovery, and smoke gate passes with explicit activation approval. |
| Railway live-bridge hosting retirement | **Shipped** | Hub | PR #69; `PHASE-0-CHECKLIST.md` §2 | Keep Railway retired. Any future live bridge must satisfy the documented Vercel-hosted activation gates before it may handle customer calls. |

## Advertising and Installer

| Requirement / idea | Status | Owner | Evidence | Next action / constraint |
| --- | --- | --- | --- | --- |
| Advertising home, campaigns, Placement Runs, Camera Mode, offline queue | **Not started** | Hub | `MASTER-PLAN.md` §6; no Advertising route/module/migration in current application inventory | Begin only after the product order and Phase 0 authorization/RLS gates allow it. |
| Placement media, GPS labeling, maps, hotspots, avoid zones, review queue | **Not started** | Hub | `MASTER-PLAN.md` §6; `FEATURE-BACKLOG.md` | Need real-device PWA design, evidence lifecycle, privacy constraints, and hosted personas. |
| Sign inventory ledger, allocations, reconciliation, atomic sign numbering | **Not started** | Hub | `MASTER-PLAN.md` §6; `FEATURE-BACKLOG.md` | Hub-owned ledger only. Quote Tool may consume acknowledged accepted-placement counts, never Hub-calculated pay. |
| Advertising piece rate/floor true-up | **Blocked** | Quote Tool | `FEATURE-BACKLOG.md`; `MASTER-PLAN.md` §6, §10 | $2.50 / $17 floor rules are planning facts, not a Hub money feature. Separate professional and owner gates apply. |
| Advertising Telegram deep link and commands | **Not started** | Quote Tool | `MASTER-PLAN.md` §11 | Quote Tool owns the bot/webhook. A Telegram photo cannot become a verified placement. |
| Installer schedule, job facts, routes, Arrived/Departed, completion | **Not started** | both | `MASTER-PLAN.md` §7; no Installer route/module/migration in current application inventory | Requires Quote Tool schedule/job/context runtime, permissions, field UI, retry/reconciliation, hosted personas, and device pilot. |
| Installer completion media and materials workflow | **Not started** | both | `FEATURE-BACKLOG.md`; `MASTER-PLAN.md` §7 | Media is optional with at most three prompts. Provenance, GPS, and installed trigger still need decisions. |
| Advertising/Installer provisioning | **Blocked** | owner decision | `AGENTS.md`; `PHASE-0-CHECKLIST.md` | No accounts until authorization, RLS, identity, device/offline, and paid-work gates pass. |

## Digests, reporting, and later candidates

| Requirement / idea | Status | Owner | Evidence | Next action / constraint |
| --- | --- | --- | --- | --- |
| Four department/Management digests | **Partial** | Hub | Existing digest routes under `src/app/api/digest/`; `MASTER-PLAN.md` §11; `FEATURE-BACKLOG.md` | Daily timing and Naldo/Jason receipt are ruled. Department recipient selection and escalation remain owner decisions; future facts must obey privacy and quality-window rules. |
| Owner reporting, leaderboards, and personal statistics | **Partial** | Hub | Existing dashboard, scorecard, analytics, and digest routes; `MASTER-PLAN.md` §§8–10 | New metrics require stable employee identity, canonical provenance, exact definitions, privacy checks, and no premature pay display. |
| Payroll CSV / QuickBooks | **Blocked** | Quote Tool | `FEATURE-BACKLOG.md`; `MASTER-PLAN.md` §10 | Quote Tool owns payroll. V1 raw CSV awaits outstanding payroll decisions; QuickBooks is later. |
| Door hangers | **Later** | owner decision | `FEATURE-BACKLOG.md` | Pay is off. Capture unit and residential privacy/visibility rules remain open. |
| Sign removal, attribution, vehicle/tools, onboarding, forecasting, route optimization, accessibility camera controls, seasonal retrospective | **Later** | owner decision | `FEATURE-BACKLOG.md` | Do not treat as committed implementation work. |

## Migration and production-release ledger

| Requirement / idea | Status | Owner | Evidence | Next action / constraint |
| --- | --- | --- | --- | --- |
| Production migration 0019 | **Shipped** | Hub | `README.md` Phase 0 state; hosted migration runbook | It was verified against the existing production public-table state. |
| Production-shaped staging rehearsal for 0020–0024 | **Shipped** | Hub | `HOSTED-MIGRATION-0017-0024-RUNBOOK.md`; `README.md` Phase 0 state; PR #60 | Staging proof does not authorize a production write. |
| Production migrations 0020–0024 | **Shipped** | owner decision | Owner authorization; reviewed dashboard driver; production post-apply checks; PRs #74–#83 | The 28 scoped derived artifacts were permanently removed without backup and 0020–0024 are present. Keep 0025 and Office Tasks out of any general migration command. |
| Production 0025 identity bridge and activation | **Shipped** | both | Production migration history; PR #88; `0025_quote_tool_identity_bridge.sql`; `20260825120136_production_quote_tool_identity_activation.sql` | Applied only through the separately approved shared-credentials rollout. Do not generalize its authorization to Office Tasks. |
| Production Office-task migration | **Later** | owner decision | Read-only production audit; `supabase/migrations/20260821141530_office_tasks.sql`; PR #89 runner | Task tables and RPCs are absent in production. The reviewed runner must match the exact timestamped identity-history prerequisite and still requires a new exact production-write authorization. |
| Historical artifacts and migration reconciliation | **Shipped** | Hub | Owner authorization; reviewed dashboard driver; production aggregate postconditions | Keep private mapping inputs out of source control and chat. Do not fabricate or replay backfill. |
| Production migration-history ledger | **Shipped** | Hub | Official Supabase migration repair; production history query; staged structural-schema comparison | Canonical `0001`–`0024` plus the separately approved timestamped identity records are recorded. Local identity source filenames do not match those two production history versions, so a general `supabase db push` remains prohibited. |
| Local database proof | **Partial** | Hub | Hub CI database-security job; `supabase/tests/database/`; 2026-08-24 local investigation | Docker Desktop was restored, but the macOS ARM Realtime image exits 139 in the private shadow helper. CI proof passed; the history repair used a staged structural-schema comparison instead. |

## Open pull requests at this snapshot

| PR | Status | Owner | Evidence / next action / constraint |
| --- | --- | --- | --- |
| #66, sales script kit | **Open PR** | Hub | PR #66 is an unmerged documentation-only proposal. Treat it as separate sales/training scope; do not claim a product surface is shipped. |
| #59, staging auth deploy gate | **Open PR** | Hub | PR #59 is a dirty draft for deferred phone-auth staging work. Do not resume until the phone-auth activation decision and Phase 0 blockers are resolved. |

## Superseded or expressly excluded work

| Requirement / idea | Status | Owner | Evidence | Next action / constraint |
| --- | --- | --- | --- | --- |
| Historical Hub planning PRs #35 and #36 | **Superseded** | Hub | `AGENTS.md` release-safety rules; `README.md` final-review-pack state | Use the reconciled pack that began with PR #37 as the only current Hub planning source. Do not reopen the superseded plans. |
| Historical B1/B2 production recovery procedure | **Superseded** | owner decision | `README.md` Phase 0 state; `PRODUCTION-0020-0024-NO-BACKUP-PLAN.md` | The no-backup dashboard driver is the current proposed procedure. It is not production-write authority. |
| Documentation PRs #84 and #85 | **Superseded** | Hub | Both were closed on 2026-08-25 after PR #86 merged the current ledger reconciliation. #84 was dirty and duplicate; #85 had no remaining net diff and retained obsolete pre-rollout wording. | Do not reopen. Record future evidence directly against current `master`. |

## Priority queue for the next session

1. **Repair the Quote Tool Flow Q contract/schema contradictions**, then implement its governed lifecycle producer, capability snapshot, current-context read, and event feed in Quote Tool. Mirror the corrected bytes in Hub only after the canonical merge.
2. **Complete hosted persona and real-token authorization proof** without provisioning field users or enabling phone auth.
3. **Plan an Office Tasks-only rollout only when needed.** Do not use a general `supabase db push`; production's approved timestamped identity history does not match the local identity source filenames.
4. **Fix the local macOS ARM Realtime shadow-helper crash** and refresh the local Quote Tool checkout before local cross-repository verification.
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
