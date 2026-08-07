# Codex Operations Hub — Independent Review Findings

> **Review date:** 2026-08-06
>
> **Reviewed plan:** [`CODEX-PLAN.md`](./CODEX-PLAN.md)
>
> **Perspectives:** owner/admin, field users, architecture/security/integration

## Outcome

Three independent reviewers examined the plan, followed by a second audit of the written document. Their accepted findings were incorporated into `CODEX-PLAN.md`. This file preserves the reasoning and highlights the remaining owner decisions without duplicating the entire plan.

## Consensus: highest-risk implementation seams

1. **Offline placement numbering:** two offline phones cannot safely choose the same next campaign Sign Number. Permanent numbering must be allocated atomically by the server after validated upload; the offline UI temporarily shows `Number pending`.
2. **Offline upload durability:** the phone must persist the original before showing success and retry idempotently, but iOS can still evict app/site data. The product must show queue/storage health and avoid unconditional survival promises.
3. **Installer background tracking:** a PWA cannot guarantee location when an iPhone is locked or external navigation backgrounds the app. Clock punches remain authoritative; route visits are automatic only with sufficient foreground evidence, otherwise suggested/confirmed manually.
4. **Identity migration:** the current email/allowlist/service-role model is not sufficient for phone OTP, route history, addresses, and field photos. Canonical employee IDs, active-status checks, RLS/storage policies, and fail-closed production configuration are launch prerequisites.
5. **Quote Tool synchronization:** “bidirectional” must be implemented as owned fields plus idempotent commands/events, not dual database ownership or direct cross-project service-role writes.
6. **Operational vs financial completion:** installer completion evidence/status must never silently complete an invoice, settle money, or trigger financial completion.
7. **Exception administration:** Naldo/Jason need queues for time corrections, open shifts, failed uploads, weak/missing GPS, route gaps, and sync failures—not only employee-facing screens.
8. **Audit/privacy:** every mutation channel requires durable actor/source auditing. Routes and customer data must not leak into leaderboards, logs, analytics, Telegram groups, or shared-device caches.

## Admin/owner review

### Incorporated

- Owner/admin versus manager mutation boundaries
- Only Naldo/Jason manage employee identity/roles and edit/approve time
- Admin screens for campaign sequence health, active/forgotten runs, GPS review, uploads, time/route exceptions, sync health, exports, and audit
- Historical placement labeling so old photos do not imply a sign remains present
- Exact reporting terms and recomputation after corrections/voids
- Hotspot provenance, moderation, staleness, and safety labeling
- Route/customer export restrictions and 120-day detailed-route retention

### Still needs owner decision

- Door-hanger location/address/privacy behavior versus yard-sign public placement spots
- Who approves more-than-20-meter GPS submissions and whether they count before approval
- Exact trigger for forgotten-run reconciliation; midnight is proposed
- Zero-photo Placement Run behavior; void/exclude is proposed
- Manager department/time allocation behavior
- Exact advertising team photo/coordinate/note visibility
- Exact coworker current-location visibility
- Forgotten clock-out and approved-period locking rules

## Field-user review

### Incorporated

- Campaign-specific one-tap run start and fixed campaign during a run
- Camera remains the primary work surface with large shutter, recent uploads, GPS/address state, optional notes, and asynchronous processing
- Active run reopens directly to Camera Mode
- X means End Placement Run and supports short undo
- Always-visible queued/uploading/review status
- Missing-GPS captures cannot silently receive a later coordinate after the worker moves
- Route gaps and manual Arrived/Departed fallbacks
- Safety warning for work near traffic and stale timestamps on location markers
- Mobile accessibility requirements, including 44-point targets and screen-reader labels/announcements
- Battery/data controls and server-side derived images

### Still needs field validation/owner decision

- Whether starting a new Placement Run may require connectivity; recommended yes, with offline continuation after start
- GPS retry/grace duration and sample freshness
- Offline queue limits and pending-upload device policy
- No-GPS/offline behavior for time punches
- Installer completion-photo camera/gallery policy
- Real-device iPhone/Android camera, permission, storage, and rapid-capture behavior

## Architecture/security/integration review

### Incorporated

- Canonical employee UUID linkage, separate role and department, active-status enforcement, OTP throttling/recovery
- Production fail-closed, RLS, storage policies, and public-route/webhook/cron security audit
- Staged repository/domain/product rename with old alias and rollback smoke tests
- Authenticated versioned service APIs with scoped credentials, replay protection, rotation, transactional outbox/inbox, idempotency, reconciliation, and dead letters
- Quote Tool ownership of canonical job operational status and completion-photo binary
- Telegram as a thin client using the same service operations and permissions as the PWA
- Telegram update/action deduplication and reply-bound confirmations
- PostGIS/SRID 4326 geospatial representation and meter-based indexed distance queries
- Atomic upload finalization and abandoned-object cleanup
- Sensitive service-worker cache policy
- Transactionally durable audit/outbox records
- Independent production kill switches for placements, Route Mode, Quote sync writes, and Telegram writes

### Still needs implementation contract

- Final SMS/OTP provider and support/recovery operations
- Versioned Quote Tool command/event schema and field/status mapping
- Installer dwell/geofence calibration and multi-installer credit
- Exact Telegram launch actions and authorized chats/groups
- Completion status/material/photo semantics against current live Quote Tool behavior
- Indefinite placement media storage cost, backup, and restore policy

## Claims intentionally downgraded after review

The plan no longer claims:

- That browser installer tracking is continuously automatic
- That iOS can never evict offline PWA data
- That midnight reconciliation was already approved
- That managers were already approved as GPS-placement reviewers
- That clock-out GPS was already confirmed
- That all installer completion photos are mandatory
- That two systems can safely own the same job status
- That a server Sign Number can be known immediately on multiple offline phones

## Recommended next review step

When Claude's plan is supplied, compare it to the source Codex plan using a decision matrix. Use this review file as a risk checklist, then create a separately approved `MASTER-PLAN.md` and jointly owned `INTEGRATION-CONTRACT.md`.
