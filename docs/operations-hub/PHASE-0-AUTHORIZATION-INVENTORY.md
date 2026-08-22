# Operations Hub Phase 0 authorization inventory

Status: **email/password remains active; staging rehearsal and shared login verified; production migration and field provisioning blocked**
Date: 2026-08-22
Merged base audited through Office task release rehearsal PR #71:
`master@c1c9146810007d16b47d669f7506b486e0f6733f`.
PR #50 merged the additive identity foundation, PR #52 merged the disabled
preview-only Phone Auth path, PR #53 vendored the canonical contract/schema
pack, and PR #54 established the original assistant-managed merge-rule
baseline. This H0 update extends it with the authenticated-byte bootstrap and
four-mode order rules. PR #57 reconciled the release ledger, PR #60 merged
fail-closed hosted-migration tooling without a hosted write, PR #58 merged
test-only local persona coverage, and PR #61 activated the authenticated
cross-repository byte gate. PRs #62, #64, #65, and #67 added Management,
shared Quote identity, and the Office shell and dashboard; PR #69 retired
Railway; and the later-merged PR #68 added the Office task foundation. PR #71
pinned its timestamped migration into the exact release-rehearsal guard. None
authorizes Advertising or Installer provisioning.

This document records what the merged Phase 0 authorization baseline enforces
and names the gates for production-rollout preparation, later staging
activation, and field release. It does not amend the byte-mirrored integration
contract or authorize a production write, Advertising identity, or Installer
identity.

## 1. Central actor

On the merged baseline, `src/lib/auth/actor.ts` resolves the Supabase Auth UUID through
one active `ops_employee_auth_identities` record to one active
`ops_employees` row. Each link record has an immutable Auth UUID and explicit
revocation history, so a later owner-approved phone-login replacement can keep
the employee UUID unchanged. The resolver ignores Auth email/phone metadata.
The employee row supplies the stored Office compatibility email, closed role,
active state, monotonic `membership_version`, and effective membership
snapshot.

`src/lib/auth/capabilities.ts` maps only a closed role vocabulary to explicit
Hub-local capabilities. Membership controls eligibility/navigation; it never
creates capabilities by itself.

- `office` maps to the existing Office employee profile. Legacy provisioning
  inputs `rep` and `office` both persist canonical role `office`.
- `advertising` and `installer` are denied at actor resolution until the field
  release gates pass. Their future profiles remain available only to policy
  unit tests.
- `owner` and `admin` map to an explicitly enumerated capability profile only
  when the immutable Supabase Auth UUID is present in the server-only approved
  Naldo/Jason ceiling. Missing/mismatched configuration fails closed.
- `manager` is recognized for negative testing and always denied in V1.
- Management is not a fourth employee department. It is an audited Naldo/Jason
  view and digest type; it never becomes a paid-work context.
- Any missing, blank, misspelled, disabled, or unknown role is denied. It never
  becomes elevated by being “not rep.”
- A missing row is a 403 denial; an unavailable identity dependency is a
  generic 503. Neither becomes an employee fallback.

The actor source is `ops_identity`. It rejects an inactive employee, malformed,
missing, or revoked Auth link, missing compatibility projection, unknown role, invalid
membership version/snapshot, no active membership, field role, unprovisioned
Manager, or unapproved Owner/Admin UUID. `membershipVersion` is a positive Hub
fact. `activeDepartmentContext` deliberately remains null until the Quote-owned
current-context projection exists; the Hub never invents that paid-time fact.

`app_users` remains only a guarded Office compatibility projection for legacy
call/coaching columns. The CLI no longer writes it directly. A narrowly granted
service-role routine atomically creates/verifies the employee, active Auth-link
record, Office membership, audit record, and compatibility row. Existing Office
employee UUIDs are preserved so PR #46 ownership and historical statistics do
not split across identities.

## 2. Route and method inventory

`src/lib/auth/routePolicy.ts` declares every current App Router surface:

- 25 pages;
- 77 API route files;
- 85 exported API handler methods;
- 110 page/API method combinations in total.

Each employee policy declares all required capabilities, department,
paid-context requirement, resource-scope class, sensitivity, and whether an
audit is required before field launch. The proxy resolves the most-specific
template, evaluates the exact HTTP method, and denies undeclared paths and
methods. A filesystem completeness test fails CI when a page or route handler
is added without a declaration.

Employee work routes belong to the Office department. The Management surface
added in PR #62 is owner/admin-only and is not a department. Consequently:

- Office employees can use only the existing tools granted to their profile;
- Office and approved Owner/Admin actors receive `office.tasks.work`. The
  `/api/tasks` GET/POST and `/api/tasks/:id` PATCH surfaces are self-scoped to
  manual tasks created by or assigned to the immutable current employee, and
  task mutations require idempotency keys and guarded database routines;
- settings, team coaching, knowledge mutation, AI pipeline, and scoreboard
  management routes require separate owner/admin capabilities;
- Advertising and Installer actors are denied from every existing Office page
  and API;
- membership alone never satisfies a route capability;
- caller-supplied `x-yll-actor-*` headers are stripped before forwarding.

Resource-scope metadata is an inventory, not a substitute for handler checks.
Merged PR #43 closes direct database access for every browser role; it
intentionally does not make a service-role handler safe.

Merged PR #46 binds lead claims and calls to immutable
`app_users.id` employee identifiers while retaining normalized email only as a
compatibility assertion. Ordinary Office employees can see redacted unclaimed
queue rows and their own claimed customer; they cannot read or mutate another
employee's claim, call, transcript, live session, segment, or follow-up.
Owner/Admin team reads are explicit, read-only where appropriate, and require a
durable sensitive-access audit. Lead, call, live-session, live-segment, and
follow-up mutations move through database routines that lock the current
actor, lead, call, and session in a consistent order and reject stale ownership
or conflicting retries.

Fresh claims, calls, dials, and follow-up sends revalidate the current
HighLevel contact and the relevant Call, SMS, or Email permission, including
global/channel DND, tags, stage, and the exact current destination. Previously
issued access does not override a later opt-out. The branch also adds explicit
`pending`, `performance`, and `training` provenance so operational metrics use
only positively identified performance records. Application/database checks
and Vercel passed before/after its human-authorized merge at `9000c683`.
The live-call bridge remained positively disabled and provided no field-release
evidence. Its Railway host was retired on 2026-08-21.

## 3. Machine callers

Machine routes are explicitly separate from employee routes and authenticate
inside their handler:

- all six Vercel Cron handlers require the exact
  `Authorization: Bearer $CRON_SECRET` credential before evaluating the
  `CRON_ENABLED` kill switch;
- Twilio Voice and Whisper fail closed when `TWILIO_AUTH_TOKEN` or the
  `X-Twilio-Signature` is missing/invalid. Outbound Voice derives the customer
  and session from a five-minute, actor-bound, atomically consumed dial grant;
  caller-supplied destinations are ignored and calling hours are rechecked;
- the public Media Streams WebSocket validates Twilio's signature against the
  exact externally configured `wss://` URL before accepting an upgrade. Each
  call receives a random, session-bound path whose digest and expiry are
  stored on the live session and atomically consumed through the Hub before
  upgrade; that durable shared state blocks replay across restarts and bridge
  replicas. Replays, a mismatched first `start` event, or media before that
  event are rejected before the bridge opens a paid Deepgram connection;
- HighLevel validates the current `X-GHL-Signature` Ed25519 signature over the
  exact raw request body and persists a unique raw-body digest so retries and
  replays are idempotent; the legacy private-workflow shared secret remains a
  constant-time header/query compatibility path;
- bridge-to-Hub transcript writes require an unpadded `LIVE_BRIDGE_SECRET` of
  at least 16 characters; a browser fallback must resolve an Office actor with
  `office.calls.work` and may post only to a call owned by that actor.

Current deployment requirements:

- `VERCEL_ENV`: exactly `preview` or `production`; missing, blank, or unknown
  values fail deployment preflight;
- `CRON_SECRET`: unpadded, at least 16 characters;
- `HUB_OWNER_ADMIN_AUTH_USER_IDS`: exactly the two approved Supabase Auth UUIDs
  for Naldo and Jason;
- signed HighLevel delivery is preferred; if the legacy compatibility path is
  still used, `GHL_WEBHOOK_SECRET` must be unpadded and at least 16 characters.

Hub Preview and production are pinned to their reviewed Hub Supabase projects.
Shared Quote Tool password identity is Preview-only and is pinned to Quote Tool
Auth project ref `chhntsbnbofyqrpivuog` at
`https://chhntsbnbofyqrpivuog.supabase.co/`; an arbitrary Quote Tool project URL
fails closed. Password login remains selected, and deployment preflight rejects
`HUB_PHONE_AUTH_STAGING_ENABLED=true` or any configured
`NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

Later live-call activation-only requirements:

- `LIVE_CUSTOMER_CALLS_ENABLED` must remain exactly `false`; runtime preflight
  rejects `true`;
- `LIVE_BRIDGE_SECRET`, `TWILIO_AUTH_TOKEN`, `LIVE_BRIDGE_URL`, and
  `LIVE_APP_BASE_URL` are required only if live calling is separately restored
  and approved. The bridge secret must be unpadded and at least 16 characters;
  the bridge URL must be credential/query-free `wss://`; the app URL must use
  HTTPS except for loopback development.

`CRON_ENABLED` remains only a kill switch. It is never caller authentication.

The production database rollout does not require or change any bridge/provider
variable. The entries above describe later defenses, not approval to place a
customer call. Customer live calling is positively disabled. See
`LIVE-CALLING-ACTIVATION-BLOCKERS.md` for the complete activation checklist.

## 4. Compatibility boundaries

Existing handlers that still call `resolveStaffRole` or `resolveRepRole` receive
only a least-privilege projection of the UUID-linked active `ops_employees`
actor: `rep`, `owner`, `admin`, or null. Field, Manager, inactive, unlinked, and
arbitrary values cannot pass legacy `role !== 'rep'` checks. The legacy
user-creation script accepts only `rep` or `office`, normalizes both to canonical
Office through the guarded atomic routine, and cannot provision Owner/Admin,
Advertising, Installer, Manager, or an arbitrary role. It prints no employee
identifier, phone, email, password, or provider error detail.

Every existing Office route is labeled `legacy_pending_projection`, not
"paid context unnecessary." The Quote-owned current-context read does not yet
exist, so the F4 clock gate remains a release block for exact customer/job
access rather than being silently represented as disabled policy.

No canonical time, pay, job, payroll, or shared-labor data was added. This
paired artifact branch changes only the approved byte mirrors, their pin,
verification, tests, and status documentation.

## 5. Remaining release blocks

This slice does **not** clear the field-user release stop:

1. The contract requires the Quote Tool to verify explicit Hub capabilities,
   but the identity events/envelope do not yet transport a capability grant or
   authorization-policy version. That requires a contract PR in the Quote Tool.
2. The Quote Tool owns active department-context intervals, but the contract
   does not yet define a canonical current-context read/projection for the Hub
   resolver. The Hub must not invent a second context ledger.
3. Production must configure and verify exactly the approved Naldo/Jason Auth
   UUID ceiling. This branch may add the immutable employee/auth link while
   preserving existing `app_users.id` values; a role string never grants
   privilege alone. Hosted provisioning evidence still remains.
4. PR #50 merged the additive Hub employee, membership, active-state, audit,
   and integration schema. PR #52 merged fail-closed preview-only Phone Auth,
   Turnstile token submission, and session-age code. The separate staging
   Supabase project now exists, public signup is off, its 30-day timebox and
   15-minute access tokens are configured, and its clean schema is verified.
   Decision 25 keeps invite-only email/password active and the phone path
   disabled. Dedicated preview linkage, provider delivery, phone test
   identities, CAPTCHA, reviewed SMS limits, owner recovery, reassignment, and
   password/session revocation are deferred activation gates.
5. PR #43 enables and forces RLS on all 31 existing tables, removes client
   schema/table/column/sequence access, and runs real `anon`, `authenticated`,
   and `service_role` impersonation in CI. Hosted preflight and semantic
   identity/persona tests remain. Service-role handlers still need
   resource-level enforcement for every route whose policy declares `self`,
   `assigned`, or `resource` scope.
   Production migration `0019` was later applied out of band and verified on
   the current 31-table hosted state. Migrations `0020` through `0024` remain
   unapplied in production. Staging verified both a clean `0001` through
   `0024` application and the sanitized production-shaped `0019` to `0024`
   reconciliation at the 38-table, 30-routine, 12-trigger target. It later
   applied `0025` separately and now has 39 tables, 33 routines, and 13
   triggers. It has not applied `20260821141530_office_tasks.sql`. The current
   clean local and CI target applies all 26 migrations and has 41 tables, 37
   routines, and 15 triggers. Production application of both
   `0025_quote_tool_identity_bridge.sql` and
   `20260821141530_office_tasks.sql` remains deferred; the production packet
   applies only `0020` through `0024`. Production backup/export review, exact
   apply authorization, and post-apply proof remain open.
6. HighLevel's legacy query-secret compatibility path must be removed after the
   workflow is reconfigured for signed delivery or a secret header.
7. Owner ruled a 30-day maximum Hub session and an online Placement Run start
   with up to 12 hours of authorized offline capture. Expired, deactivated, or
   revoked-device writes quarantine for Naldo/Jason review and never
   automatically count toward pay or inventory. Those behaviors are not
   implemented by this foundation. Placement/photo visibility is ruled under
   Decision 20, but Advertising-phase enforcement and hosted persona proof
   remain open.
8. The lead-work branch introduces positive metric provenance for future
   reads, but historical derived records that may already combine performance
   and practice data still require a separately reviewed audit and data repair.
   Weekly digests, brain reviews, proposals, edited playbooks, and unsafe
   personal-touch rows must be audited and rebuilt, recreated, or invalidated
   before release reporting. Current feedback reads already require positively
   proven performance scores and are not an additional deletion class.
9. Customer live calling remains disabled until every provider lifecycle,
   media finalization, speaker attribution, ordered delivery, coaching
   deduplication, recovery, and real-provider smoke gate in
   `LIVE-CALLING-ACTIVATION-BLOCKERS.md` passes.

Until these gates pass, no Advertising or Installer account may be provisioned.

## 6. Merged lead-work authorization slice

PR #46 addresses the Office blockers from the PR #43 adversarial review without
weakening the field-provisioning stop:

1. Lead claim/dismiss, manual completion, live start/dial/stream/segment/end,
   and follow-up edit/send use narrowly granted transaction routines rather
   than independent service-role read-then-write sequences.
2. Claims and calls carry immutable employee IDs. An ordinary employee must be
   the current active claimant, and all compatibility email fields must still
   match that employee.
3. Queue and inbound surfaces redact unclaimed customer PII, hide another
   employee's claim, and expose full work data only after a permitted claim.
4. New customer work requires a current HighLevel contact and a positive
   channel-specific permission check. Stale queue data or an earlier grant
   cannot authorize a call or follow-up after opt-out.
5. Completion, start, segment, and send request identifiers distinguish safe
   retries from conflicting payloads; follow-up provider message identifiers
   become immutable evidence rather than treating a conversation ID as proof
   of delivery.
6. Calls, transcripts, and scores carry positive metric provenance. Training
   and incomplete live attempts are excluded from performance loaders.
7. The simulator customer-call path is removed in favor of Practice, and live
   customer calling remains disabled behind the positive activation gate.

Verification on 2026-08-13 passed the pinned-contract check, TypeScript, ESLint,
1,008 Vitest tests across 119 files, the standard production build, 117
lead-work pgTAP assertions, 259 default-deny assertions, 18 legacy-backfill
assertions, and desktop plus 390px login-shell smokes without overflow or
console errors. GitHub checks and Vercel then passed before/after the
human-authorized merge at `9000c683`; the disabled live-call bridge correctly
refused to start. Its Railway host was retired on 2026-08-21. Authenticated
production and real-provider smokes remain.

## 7. Identity-foundation verification and remaining work

The local PostgreSQL/parser harness applies all 26 migrations and passed the
seeded legacy upgrade, service-role provisioning and exact retry, deactivation
denial, all four preflight-failure seeds, and the current exact manifest of 41
tables, 37 routines, and 15 triggers. The completed production-shaped staging
rehearsal intentionally stopped at `0024`, where it verified 38 tables, 30
routines, and 12 triggers. Shared staging later applied only `0025`, where it
has 39 tables, 33 routines, and 13 triggers. PR #50 historically executed 51
identity and 304 default-deny assertions. Merged PR #58 expanded its
then-current suites to 53 identity and 307 default-deny assertions; PR #68 adds
dedicated Office task pgTAP and expanded manifest coverage. The seeded-upgrade
suite remains 17.
The database, upgrade-order, and protective preflight suites passed before
each applicable human-authorized merge.

1. Complete hosted semantic persona and real-token PostgREST proof for the
   merged immutable Hub employee/Auth link, active state, membership versioning,
   and local identity audit without enabling field provisioning. Independent
   code review and CI are complete. Cross-boundary outbox/inbox/DLQ
   implementations may now be built against the vendored canonical schema
   under the remaining activation gates.
2. Audit and repair or invalidate historical derived performance outputs.
3. Land the Quote-owned capability/policy-version transport and current-context
   projection before consuming those protected facts in the Hub. The canonical
   shared schema/OpenAPI artifacts are now vendored and pinned.
4. Preserve the completed production-shaped staging migration and historical-
   reconciliation evidence. Use the existing staging project for remaining
   RLS, real-key denial, and hosted-persona proof. Keep
   invite-only email/password active and phone auth false under Decision 25.
   Twilio Verify, Turnstile, dedicated phone-login deployment, owner-only
   recovery, phone reassignment, and password/session revocation remain parked
   until a later activation decision. The 30-day signed-session-age check is
   already merged for that future path.
5. Before that activation exposes Auth-link replacement, make every `0020`
   employee mutation atomically lock and verify the current active Auth link
   against its supplied Auth UUID. The foundation exposes no replacement path,
   and its legacy Office provisioner refuses any employee with link history.
   The future Owner/Admin routine must also audit actor, reason, revocation, and
   replacement creation in the same transaction.
6. Before exposing membership changes, atomically synchronize membership
   revocation into the `app_users` compatibility projection or make every
   `0020` employee mutation verify the current effective membership. The
   foundation exposes no service/browser membership mutation path.
7. Before field activation, replace the Office-only required compatibility
   email in the runtime actor/legacy attribution bridge with an explicit
   phone-only field shape. Nullable field storage does not by itself make a
   phone-only Advertising or Installer actor resolvable.
8. Complete hosted preflight, password sign-in, real-token denial, and semantic
   persona integration tests before any field account is provisioned. Password
   recovery remains Quote Tool-owned and is not a production rollout smoke.
9. Keep live customer calling disabled until the separate activation checklist
   is fully implemented, tested, reviewed, and approved.
