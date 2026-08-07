# Integration contract: Operations Hub <-> Quote Tool (draft v0.1)

> Jointly owned. Neither system builds against an endpoint, event, or field
> that is not in this file. Changes land by PR touching this file, reviewed by
> both assistants, approved by Naldo for anything that moves money or changes
> ownership. Draft v0.1 defines shapes and flows; exact JSON schemas get
> nailed per-endpoint in the PR that implements each one, updating this file
> in the same PR.

## 1. Transport, auth, and delivery rules (both directions)

- HTTPS service APIs, versioned paths (`/api/v1/...` hub-side; the Quote Tool
  uses its existing route conventions with an `x-api-version` header).
- Scoped machine credentials per direction, environment-specific, never
  browser-session credentials, rotated; replay protection via signed
  timestamp+nonce (CODEX §20).
- Every mutation carries an idempotency key. Retries return the original
  result, never a duplicate.
- Deliveries go through a transactional outbox on the writer and an inbox
  dedup table on the reader, with aggregate version, expected prior version,
  actor, source channel, correlation and causation IDs, retry/backoff, and a
  dead-letter queue with an admin surface (CODEX §20, §23).
- Every Quote Tool route reachable by the Hub or crew is in `operatorGate`'s
  allowlist in the same PR that creates it, verified logged out.
- Kill switches per flow, independently: hub->qt attendance events, qt->hub
  job read/events, completion commands, telegram relay (CODEX §27 Phase 0).
- Clock times in UTC; the weekly pay boundary and business days are
  America/New_York.

## 2. Identity mapping

- Hub `employees.employee_id` (UUID) is canonical.
- Quote Tool `crew_members`: `id`, `hub_employee_id` (nullable until Hub
  Phase 0 backfill), `telegram_user_id`, `display_name`, `base_rate_cents`,
  `in_p4p_pool`, `pay_mode` (`hourly` | `p4p` | `shadow`), `language`,
  `active`, timestamps. Pay fields are Quote Tool truth; identity fields are
  a cache of Hub truth.
- Hub emits employee lifecycle events; the Quote Tool consumes and updates
  its cache. The Quote Tool never creates employees.
- `EmployeeUpserted` payload: employee_id, display_name, departments[],
  role, active, telegram_user_id?, language. `EmployeeDeactivated`:
  employee_id, at, reason. Deactivation also invalidates the Telegram
  linkage relay-side.

## 3. Flow A: Quote Tool -> Hub, jobs read model

The Hub renders installer days from this; it stores a read model, never
authoritative job data.

- `GET qt:/api/ops/jobs?assigned_to={employee_id}&date={yyyy-mm-dd}`
  Returns per job: job_id, customer display name, address, lat/lng if
  geocoded, scheduled window, assigned employee_ids[], budgeted_hours,
  canonical status, service type. Address visibility follows role rules
  (assigned installers and admins only, CODEX §6).
- Events: `JobAssigned`, `JobUnassigned`, `JobRescheduled`,
  `JobStatusChanged` (job_id, status, at, version). The Hub uses these to
  invalidate its read model and to know which jobs Route Mode may match
  visits against.
- **Clock-gate rule:** the Hub's own day view for installers must return
  empty until the employee has an open Hub shift (server-side check on the
  Hub; DECISIONS R5). The Quote Tool applies the same gate on any surface it
  serves to installers.

## 4. Flow B: Hub -> Quote Tool, attendance and labor spans

The pay engine's inputs. Only APPROVED records flow; suggestions and
unapproved corrections never leave the Hub.

- `ShiftApproved`: employee_id, shift_id, clock_in_at, clock_out_at,
  break_spans[], stoppage/exception flags, approved_by, approved_at,
  version. Weekly floor and overtime math read these.
- `JobVisitApproved`: visit_id, employee_id, job_id (Quote Tool id),
  arrived_at, departed_at, source (`gps_auto` | `gps_suggested_confirmed` |
  `manual_punch` | `office_entry`), confidence, stoppage_reason?, entry_kind
  (`install` | `rework` | `non_billable` | `travel`), approved_by,
  approved_at, version. These land in the Quote Tool's per-job labor table
  (DECISIONS R2, R3).
- `JobVisitCorrected` / `ShiftCorrected`: same shape plus supersedes_id.
  After the Quote Tool's payroll lock, corrections create next-period
  adjustment rows, never retroactive edits (CLAUDE A5 Phase 2).
- Ordering: per-aggregate versions; the Quote Tool rejects stale versions
  and dead-letters gaps for reconciliation (CODEX §20).
- **Weekly payroll dependency:** the Quote Tool's pay run for week N reads
  only events received and approved by the cutoff; the Hub's approval queue
  must clear before the cutoff. The pay run reports unapproved-span counts
  loudly rather than silently paying less (DECISIONS R3 consequences).

## 5. Flow C: completion commands (Hub or Telegram -> Quote Tool)

- `POST qt: field completion command` with job_id, employee_id, note?,
  photo_refs[], idempotency key. The Quote Tool validates assignment +
  status, stores `field_work_completed` or
  `completion_submitted_for_office_review`, emits `JobStatusChanged` back.
  Never touches invoices or money (CODEX §19, master plan §8).
- Photos post through the Quote Tool's existing photo upload path; the
  command carries returned photo reference IDs, the binary lives once.
- This extends the existing bot `completeInstall` operation; there is one
  canonical completion code path regardless of channel.

## 6. Flow D: Telegram relay (Quote Tool webhook -> Hub)

- The Quote Tool webhook authenticates the Telegram user against
  `crew_members.telegram_user_id`, then calls Hub service APIs for Hub-owned
  actions: `POST hub:/api/v1/attendance/clock-in|clock-out`,
  `POST hub:/api/v1/visits/{id}/confirm`, break start/stop.
- Relay calls carry: hub employee_id, source `telegram`, the Telegram
  update_id (deduped both sides), idempotency key, and a reply-bound
  confirmation token for consequential writes (CODEX §21).
- Verified advertising placements never originate from Telegram (CODEX §21).

## 7. Flow E: earnings display (Hub -> employee, data from Quote Tool)

- `GET qt:/api/ops/me/earnings?employee_id=...&period=...` returns, per pay
  period: base_pay_cents, hours breakdown, pool_share_provisional_cents,
  pool_share_earned_cents, floor_true_up_cents, bonuses[], forfeitures[]
  (job, reason, window dates), pay_mode, and the week-N/week-N-1 split
  (hours current week, performance pay following week).
- **Display rule, binding:** provisional and earned are separate fields and
  the Hub renders them distinctly; provisional is labeled pending quality
  review, never earned (CLAUDE A3). Same rule for any leaderboard money.
- `GET qt:/api/ops/me/stats` (efficiency, BH vs actual) and
  `GET qt:/api/ops/leaderboard` follow the same rule.

## 8. Vocabulary lock (from PLAN-COMPARISON §6)

shift, break, job time entry (QT pay input), job visit (Hub evidence),
Route Mode, Placement Run, field completion, provisional/earned/paid/
forfeited, clock gate. Both codebases use these names in schemas and APIs so
grep works across repos.

## 9. Change process

1. PR against this file first, implementation second, or same PR touching
   both.
2. Both assistants named as reviewers in the PR body; a human (Naldo or
   Jason) merges.
3. Anything moving money, changing field ownership, or changing the legal
   display rule needs Naldo's explicit line in DECISIONS.md.
