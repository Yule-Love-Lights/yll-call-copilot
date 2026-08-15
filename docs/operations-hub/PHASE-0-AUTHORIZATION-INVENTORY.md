# Operations Hub Phase 0 authorization inventory

Status: **route and database base-role gates merged; lead-work resource slice in progress; field provisioning blocked**
Date: 2026-08-13
Merged base: PRs #41 through #43 at
`master@7962a8f025186c54acab66d47c32e93991e59a30`. The lead-work resource
slice is on `codex/operations-hub-phase-0-lead-access`; it remains unmerged and
its local repository, database, build, and unauthenticated responsive-smoke
gates passed on 2026-08-13. CI, human review, hosted checks, and authenticated
production smokes remain.

This document records what the Phase 0 capability branch actually enforces.
It does not amend the byte-mirrored integration contract and does not authorize
Advertising or Installer identities.

## 1. Central actor

`src/lib/auth/actor.ts` resolves one email-linked bootstrap request actor from
the Supabase Auth user and matching `app_users.id`. This is not yet the final
immutable identity link. `src/lib/auth/capabilities.ts` maps
only a closed role vocabulary to explicit Hub-local capabilities.

- `rep` and `office` map to the legacy Office employee profile.
- `advertising` and `installer` are denied at actor resolution until the field
  release gates pass. Their future profiles remain available only to policy
  unit tests.
- `owner` and `admin` map to an explicitly enumerated capability profile only
  when the immutable Supabase Auth UUID is present in the server-only approved
  Naldo/Jason ceiling. Missing/mismatched configuration fails closed.
- `manager` is recognized for negative testing and always denied in V1.
- Any missing, blank, misspelled, disabled, or unknown role is denied. It never
  becomes elevated by being “not rep.”
- A missing row is a 403 denial; an unavailable identity dependency is a
  generic 503. Neither becomes an employee fallback.

The current source is explicitly labeled `legacy_app_users`. Row presence is
the current active-status fact; department membership is inferred from the
closed profile; `membershipVersion` and `activeDepartmentContext` are null.
The additive Hub identity schema must replace those bootstrap facts before
field provisioning.

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

The current lead-work branch binds lead claims and calls to immutable
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
only positively identified performance records. These controls remain branch
implementation, not release evidence, until the full gates pass and a human
merges the branch.

## 3. Machine callers

Machine routes are explicitly separate from employee routes and authenticate
inside their handler:

- all five Vercel Cron handlers require the exact
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

Existing handlers that still call `resolveStaffRole` or `resolveRepRole` now
receive only `rep`, `owner`, `admin`, or null. Field, Manager, and arbitrary
values cannot pass legacy `role !== 'rep'` checks. The legacy user-creation
script accepts only `rep` or `office`; it cannot provision Owner/Admin,
Advertising, Installer, Manager, or an arbitrary role.

Every existing Office route is labeled `legacy_pending_projection`, not
"paid context unnecessary." The Quote-owned current-context read does not yet
exist, so the F4 clock gate remains a release block for exact customer/job
access rather than being silently represented as disabled policy.

No canonical time, pay, job, payroll, or shared-labor data was added. The
integration-contract mirror was not edited.

## 5. Remaining release blocks

This slice does **not** clear the field-user release stop:

1. The contract requires the Quote Tool to verify explicit Hub capabilities,
   but the identity events/envelope do not yet transport a capability grant or
   authorization-policy version. That requires a contract PR in the Quote Tool.
2. The Quote Tool owns active department-context intervals, but the contract
   does not yet define a canonical current-context read/projection for the Hub
   resolver. The Hub must not invent a second context ledger.
3. Production must configure and verify exactly the approved Naldo/Jason Auth
   UUID ceiling and migrate from email-linked `app_users` to the additive
   immutable employee/auth link. A role string never grants privilege alone.
4. The additive Hub employee, membership, active-state, audit, and integration
   schema has not landed. Phone OTP and revocation have not landed.
5. PR #43 enables and forces RLS on all 31 existing tables, removes client
   schema/table/column/sequence access, and runs real `anon`, `authenticated`,
   and `service_role` impersonation in CI. Hosted preflight and semantic
   identity/persona tests remain. Service-role handlers still need
   resource-level enforcement for every route whose policy declares `self`,
   `assigned`, or `resource` scope.
6. HighLevel's legacy query-secret compatibility path must be removed after the
   workflow is reconfigured for signed delivery or a secret header.
7. Open owner decisions for cached sessions, deactivated-device writes, and
   placement/photo visibility remain protective-default deny.
8. The lead-work branch introduces positive metric provenance for future
   reads, but historical derived records that may already combine performance
   and practice data still require a separately reviewed audit and data repair.
   Weekly digests, brain reviews, proposals, feedback, and other materialized
   outputs must be rebuilt or invalidated before they can be trusted for
   release reporting.
9. Customer live calling remains disabled until every provider lifecycle,
   media finalization, speaker attribution, ordered delivery, coaching
   deduplication, recovery, and real-provider smoke gate in
   `LIVE-CALLING-ACTIVATION-BLOCKERS.md` passes.

Until these gates pass, no Advertising or Installer account may be provisioned.

## 6. Current lead-work authorization slice

The current branch addresses the Office blockers from the PR #43 adversarial
review without weakening the field-provisioning stop:

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

The implementation and local gates are present on the branch. Verification on
2026-08-13 passed the pinned-contract check, TypeScript, ESLint, 1,008 Vitest
tests across 119 files, the standard production build, 117 lead-work pgTAP
assertions, 259 default-deny assertions, 18 legacy-backfill assertions, and
desktop plus 390px login-shell smokes without overflow or console errors.
Authentication was intentionally not bypassed, so hosted authenticated and
real-provider smokes remain.

## 7. Work remaining after this slice

1. Receive CI and human review, run the hosted checks, and human-merge the
   lead-work branch.
2. Audit and repair or invalidate historical derived performance outputs.
3. Complete the additive immutable Hub identity, phone OTP, revocation,
   membership, and Quote-owned active-context projection work.
4. Complete hosted preflight and semantic persona integration tests.
5. Keep live customer calling disabled until the separate activation checklist
   is fully implemented, tested, reviewed, and approved.
