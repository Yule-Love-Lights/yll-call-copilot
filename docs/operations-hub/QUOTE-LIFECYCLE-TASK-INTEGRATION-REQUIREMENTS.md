# Quote lifecycle and task integration requirements

Status: **Flow Q canonical draft merged; corrective schema and runtime implementation still required**
Updated: 2026-08-22

## Purpose

Office needs trustworthy quote turnaround, active-quoting, rework, promise,
and task views. Quote Tool remains the source of truth for quote requests,
quotes, assignments, lifecycle facts, customer delivery, paid workday data,
and every `/api/ops/v1` endpoint. Operations Hub remains the source of truth
for Hub tasks and their Office presentation.

Quote Tool PR #878 merged canonical Flow Q as contract `v1.5.0-draft` and
schema `1.1.0-draft`; this branch mirrors those files byte-identically. The
canonical contract now controls exact cross-repository behavior. This document
remains a Hub implementation and release checklist and does not amend the
contract, OpenAPI, or JSON Schema.

The merged draft is not implementation-ready. Its normative text allows a
`QuoteRequestReceived` before any quote exists and requires stable request and
source identifiers, while the shared `QuoteLifecycleEvent` schema requires a
non-null `quote_id`, makes `request_id` optional, and omits the required source
pair. The same flat event schema omits several event-specific fields required
by the contract and allows envelope `entity_version = 0` even though Flow Q
starts quote versions at one. Its closed `HubCapability` enum also omits the
Hub's already-merged `office.tasks.work` grant, so it cannot represent a
complete current Office authorization snapshot. A corrective Quote Tool
contract/schema PR must resolve those contradictions and be mirrored here
before either repository implements or activates Flow Q.

## Current boundary and non-claims

The current Quote Tool dashboard metric is not approved turnaround data:

- `quotes.created_at` records the first persisted Calculate/save or a clone,
  not when a customer request arrived.
- `quote_sent_at` can be restamped by resend or revive, and is written before
  delivery is proven.
- Creator identity is an `auth.users` ID, not a governed Hub employee ID.
- There is no durable request link, quote assignment history, immutable first
  send, meaningful-edit history, explicit wait interval, revision history, or
  quote lifecycle event stream.

Until the corrective schema and runtime requirements below are delivered and
versioned, Hub must show an explicit unavailable state for real Quote Tool
timing, workload, and quote-origin task data. It must not infer those values
from contacts, inbox rows, timestamps, browser activity, or email addresses.

## Required durable Quote Tool facts

### Requests, people, and ownership

1. Add a durable `quote_requests` source record with a stable ID,
   `received_at`, `source_system`, `source_record_id`, customer/contact
   reference, optional linked quote ID, and current assigned employee ID.
   `source_system + source_record_id` is unique.
2. Inbound integrations deliberately create or link a request. A time-based
   join to an inbox item or contact is not acceptable.
3. Add an owner-governed Office operator-auth-to-Hub-employee identity link.
   Existing field-crew identity links do not satisfy this requirement. Unknown
   identities remain unknown and enter reconciliation, rather than being
   guessed from an email address.
4. Preserve quote assignment history. Assignment and unassignment record the
   prior/current employee, server timestamp, actor, and reason where supplied.

### Quote lifecycle

1. Add `entity_version bigint` to the Quote aggregate and an immutable
   `first_sent_at`. `quote_sent_at` may remain a latest-send convenience field,
   but no resend, revive, or retry may alter `first_sent_at`.
2. Write append-only `quote_lifecycle_events` transactionally with an outbox
   row. Each event has a stable `event_id`, quote ID, per-quote sequence and
   entity version, server/effective timestamps, actor employee ID when known,
   local auth ID for forensics where appropriate, source/source reference,
   correlation ID, causation ID, idempotency key, and versioned payload.
3. The canonical closed event union is:

   - `QuoteRequestReceived`, `QuoteRequestLinked`, `QuoteCreated`
   - `QuoteAssigned`, `QuoteUnassigned`
   - `QuoteMeaningfulEditRecorded`, `QuoteRevisionSaved`
   - `QuoteWorkWaitStarted`, `QuoteWorkWaitEnded`
   - `QuoteSentRecorded`, `QuoteDeliveryAttempted`,
     `QuoteDeliveryOutcomeRecorded`
   - `QuoteChangesRequested`, `QuoteAccepted`, `QuoteDeclined`,
     `QuoteExpired`, `QuoteAbandoned`, `QuoteCancelled`, `QuoteBooked`,
     `QuoteReopened`
   - `QuotePromiseRecorded`, `QuotePromiseSuperseded`,
     `QuotePromiseCancelled`, `QuotePromiseFulfilled`

4. A meaningful edit is a successful persisted customer-facing, design, or
   pricing change with no-op detection. It is not keystroke, mouse, focus, or
   browser-presence surveillance.
5. Wait events use explicit owner-approved reasons. The initial required
   values are `approval` and `customer_information`.
6. A send event includes quote/revision ID, first-send flag, local handoff
   timestamp, mode (`tool_sms`, `tool_email`, `tool_both`, or
   `manual_external`), actor employee, and integer total cents. It records a
   customer handoff, not a delivery guarantee.
7. Delivery events record a stable attempt ID, send/revision link, channel,
   fresh-versus-retry, retry lineage, attempted/resolved times, provider ID,
   sanitized error code, and one of `accepted`, `failed`, or `unknown`.
   Unknown is first-class and later delivered/bounced stages may extend it.
8. Long-turnaround reason reporting is not in the current closed event union.
   It remains unavailable until a later canonical amendment and owner-approved
   reason enum exist.

## Metric definitions

- Turnaround is `first_sent_at - request_received_at`.
- Revision count is the number of `QuoteRevisionSaved` events.
- Post-send rework is a revision after the first-send event or its linked base
  send event.
- Delivery quality is reported independently from local send/handoff.
- Quote value crosses the boundary as integer cents.

An active-quoting-time metric remains disabled until Naldo approves the
inactivity cap, included change domains, rebook/import handling, and
manual-send treatment. If approved, it may sum server-recorded meaningful work
intervals with that cap. It must never use local typing or browser presence.
Conversion denominator and numerator also need an owner decision before a
cross-repository metric is presented.

## Event feed and versioning

Quote Tool must expose a dedicated authenticated, HMAC-protected cursor feed,
for example `GET /api/ops/v1/quote-events?since&limit`. It must not overload
the planned `commitment-events` feed. The feed needs stable ordering, cursor
semantics, retention, replay behavior, source watermark, outbox delivery,
acknowledgement/reconciliation, kill switch, and dead-letter handling.

Every emitted event must carry the common canonical envelope, the stable
request and/or quote identifiers applicable to that event, opaque customer
reference, actor and assignee employee IDs when known, optional job ID,
correlation/causation IDs, and contract/schema versions. The corrective Quote
Tool change must update the canonical contract,
machine OpenAPI, JSON Schema, examples, and conformance tests together, then
bump the approved versions. Hub mirrors the resulting artifacts exactly and
rejects unknown, missing, malformed, or unsupported version declarations.

## Hub task projection

Hub creates and owns tasks. Quote Tool never creates, mutates, dismisses, or
completes a Hub task directly.

For every projected event, Hub enforces unique
`(source_system = 'quote_tool', source_event_id)`, retains the source record
type and quote ID, and records optional opaque contact/job references. A Hub
task may cite a Quote Tool outcome event as evidence, but feed acknowledgement
is not task completion. The task lifecycle needs its own assignment,
reassignment, block, dismissal, due-date, evidence, and audit rules.

Call-origin tasks have one additional prerequisite: an immutable call
handler-to-Hub-employee mapping. Calls without dependable attribution enter an
unclaimed reconciliation lane. Hub must not assign them to a likely employee.

## Acceptance bar

Before any real timing metric or quote-origin task activation:

1. Lifecycle and outbox writes are one transaction, are idempotent, and are
   proven under retry and replay.
2. Resend, revive, manual handoff, failed delivery, unknown delivery, and
   later delivery status preserve the immutable first-send fact.
3. A request cannot be inferred from unrelated contact, inbox, or clock data.
4. Unknown actor/assignee identities are quarantined and visible for owner
   reconciliation.
5. Feed pagination, duplicate delivery, out-of-order arrival, retention,
   acknowledgement, kill switch, and dead-letter paths have conformance tests.
6. Existing rows with unrecoverable request or first-send history remain
   explicitly unknown. No backfill fabricates those facts.
7. The corrective Quote Tool canonical change is mirrored byte-identically in
   Hub and the authenticated cross-repository byte gate passes on the exact
   heads.
