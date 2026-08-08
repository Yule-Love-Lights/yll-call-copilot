# Operations Hub Phase 0 authorization inventory

Status: **route capability gate implemented; resource/RLS work remains; field provisioning blocked**
Date: 2026-08-07
Stacked base: PR #41 commit `754e4d64b3a6528067b0467d5dc52f9e96d60325`

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
- 73 API route files;
- 80 exported API handler methods;
- 104 page/API method combinations in total.

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
This slice binds call updates, live-session reads/end/segments, follow-up
edits/sends, and coaching ratings to the owning employee. Owner/Admin team
overrides are explicit and fail closed unless their sensitive-access audit is
durable; a team member cannot impersonate another rep's coaching rating.
Remaining service-role handlers and every RLS policy still require the work in
section 5 before field launch.

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
5. Existing-table RLS/default-deny policies and real impersonated-role tests
   have not landed. Service-role handlers need resource-level enforcement for
   every route whose policy declares `self`, `assigned`, or `resource` scope.
6. HighLevel's legacy query-secret compatibility path must be removed after the
   workflow is reconfigured for signed delivery or a secret header.
7. Open owner decisions for cached sessions, deactivated-device writes, and
   placement/photo visibility remain protective-default deny.

Until these gates pass, no Advertising or Installer account may be provisioned.
