# Operations Hub Phase 0 authorization inventory

Status: **email/password remains active; staging database verified; phone-auth activation deferred; field provisioning blocked**
Date: 2026-08-20
Merged base: PRs #41 through #54 at
`master@bad885dc85b5d2c255bad8567b21a83f6ab2d4ec`. PR #50 merged the additive
identity foundation, PR #52 merged the disabled preview-only Phone Auth path,
PR #53 vendored the canonical contract/schema pack, and PR #54 is the current
rule baseline. None authorizes Advertising or Installer provisioning.

This document records what the merged Phase 0 authorization baseline enforces
and names the activation gates for staging-only work on the current branch.
It does not amend the byte-mirrored integration contract and does not authorize
Advertising or Installer identities.

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

- 24 pages;
- 74 API route files;
- 81 exported API handler methods;
- 105 page/API method combinations in total.

Each employee policy declares all required capabilities, department,
paid-context requirement, resource-scope class, sensitivity, and whether an
audit is required before field launch. The proxy resolves the most-specific
template, evaluates the exact HTTP method, and denies undeclared paths and
methods. A filesystem completeness test fails CI when a page or route handler
is added without a declaration.

All existing employee routes belong to the Office department. Consequently:

- Office employees can use only the existing tools granted to their profile;
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
Railway remained intentionally red because the disabled live-call bridge
correctly refused to start; this is not field-release evidence.

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

Required deployment configuration:

- `CRON_SECRET`: unpadded, at least 16 characters;
- `LIVE_BRIDGE_SECRET`: unpadded, at least 16 characters and identical in the
  Hub and bridge process;
- `TWILIO_AUTH_TOKEN`: required before Twilio is considered configured;
- `LIVE_CUSTOMER_CALLS_ENABLED`: must remain exactly `false`; runtime preflight
  rejects `true` and the live bridge exits unless the separately reviewed
  activation gates are satisfied;
- `LIVE_BRIDGE_URL`: the same credential-free, query-free `wss://` base URL in
  the Hub and bridge process so exact upgrade signatures can be reconstructed;
- `LIVE_APP_BASE_URL`: the Hub's `https://` base URL used for durable grant
  consumption and transcript writes; plaintext HTTP is accepted only on a
  loopback host for local development;
- `HUB_OWNER_ADMIN_AUTH_USER_IDS`: exactly the two approved Supabase Auth UUIDs
  for Naldo and Jason;
- signed HighLevel delivery is preferred; if the legacy compatibility path is
  still used, `GHL_WEBHOOK_SECRET` must be unpadded and at least 16 characters.

`CRON_ENABLED` remains only a kill switch. It is never caller authentication.

The Twilio and bridge entries above describe preparatory defenses, not approval
to place customer calls. Customer live calling is positively disabled. See
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
   unapplied in production. Staging has verified a clean `0001` through `0024`
   application and the 38-table, 30-routine, 12-trigger target; the
   production-shaped `0019` to `0024` reconciliation rehearsal remains open.
6. HighLevel's legacy query-secret compatibility path must be removed after the
   workflow is reconfigured for signed delivery or a secret header.
7. Owner ruled a 30-day maximum Hub session and an online Placement Run start
   with up to 12 hours of authorized offline capture. Expired, deactivated, or
   revoked-device writes quarantine for Naldo/Jason review and never
   automatically count toward pay or inventory. Those behaviors are not
   implemented by this foundation. Placement/photo visibility is ruled under
   Decision 20, but Track B enforcement and hosted persona proof remain open.
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
human-authorized merge at `9000c683`; Railway correctly remained red because
the disabled live-call bridge refused to start. Authenticated production and
real-provider smokes remain.

## 7. Identity-foundation verification and remaining work

The local PostgreSQL/parser harness applied all 24 migrations and passed the
seeded legacy upgrade, service-role provisioning and exact retry, deactivation
denial, all four preflight-failure seeds, and exact manifests of 38 tables, 30
routines, and 12 triggers. The authored pgTAP suites expect 51 identity and 17
seeded-upgrade assertions, while default-deny expands to 304 assertions. PR #50
CI executed the database, upgrade-order, and protective preflight suites
successfully before the human-authorized merge.

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
4. Use the existing staging Supabase project for the production-shaped
   migration, historical-reconciliation, RLS, and hosted-persona proof. Keep
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
8. Complete hosted preflight, authenticated recovery, real-token denial, and
   semantic persona integration tests before any field account is provisioned.
9. Keep live customer calling disabled until the separate activation checklist
   is fully implemented, tested, reviewed, and approved.
