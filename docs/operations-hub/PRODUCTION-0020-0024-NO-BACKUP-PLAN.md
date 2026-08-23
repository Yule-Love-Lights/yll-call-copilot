# Production 0020-0024 no-backup migration plan

Status: **owner-selected direction; preparation only, not production-write authorization**
Date: 2026-08-23
Repository target: `Yule-Love-Lights/yll-call-copilot`
Database target: `yll-call-copilot` (`mjmociuxxxwxvasnpxav`)

## Decision

The owner accepts permanent loss of YLL Call Copilot application data, including uploaded call-log copies and derived analysis. The original call-log files remain available for re-import if needed.

The production rollout no longer requires a recovery dump, isolated restore, or a data-retention export. This is unrelated to Railway, which is already retired. This plan concerns Supabase schema work that migration-dependent Hub routes require.

## Exact scope

The future operation may apply only canonical migrations `0020` through `0024`, including their required reconciliation and migration-history repair.

It preserves invite-only email/password login. It must not apply `0025_quote_tool_identity_bridge.sql` or `20260821141530_office_tasks.sql`.

It must not change Quote Tool, Supabase Auth users, Railway, Vercel environment settings, Twilio, Turnstile, Cloudflare, customer sends, live calls, recording releases or retries, or cron activation.

## What is removed

- Production database dump creation.
- Isolated dump restore and restore proof.
- Recovery-artifact retention and a second-person data-export review.

## What remains required

- A read-only, aggregate-only production compatibility check with a current credential and reviewed TLS certificate.
- A temporary private identity mapping needed to retain password login. It is operational input, not a backup, and must not be printed or retained after the transaction.
- A generated, hash-bound, one-transaction driver. A mismatched schema, migration history, identity mapping, or expected row count stops before the first write.
- A Vercel maintenance pause/resume only for the later authorized write window.
- Normal repository checks and post-apply read-only proof.

The existing reconciliation deletes specific legacy metric artifacts that violate the new invariant. That deletion remains in the same transaction. It is not a full database wipe, does not touch Quote Tool, and does not delete `auth.users`.

## Current blocker

The latest read-only attempt was rejected by PostgreSQL password authentication before any query ran. Replace the private Keychain maintenance URL with a current production credential. Do not put a credential in chat, repository files, or a pull request.

Docker must also be running for the local canonical-schema comparison. These are tooling prerequisites, not recovery steps.

## Required future authorization

After this plan is merged and the private credential passes the read-only check, the owner must name the exact merged `master` SHA, project ref, driver SHA-256, current migration/history result, aggregate reconciliation counts, and private identity-mapping digest.

That message must explicitly permit permanent deletion of the driver's in-scope legacy Copilot records without a recovery backup and permit pause/resume of only the Hub Vercel production project.

Any changed input invalidates the authorization. A failed compatibility check or transaction resumes Vercel and stops. It must not fall back to a manual migration, broad delete, or another database target.

## Verification after the future transaction

The post-apply proof must show canonical `0020` through `0024` schema and history, forced RLS/default-deny posture, retained password-login identity mapping, and working non-provider Hub health routes. It must not enable cron, sends, live calling, or Railway.
