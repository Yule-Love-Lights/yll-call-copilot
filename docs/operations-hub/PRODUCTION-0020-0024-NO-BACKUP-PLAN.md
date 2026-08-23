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

- A read-only, aggregate-only production compatibility check through an authenticated Supabase dashboard session or a current reviewed direct connection.
- A temporary private identity mapping needed to retain password login. It is operational input, not a backup, and must not be printed or retained after the transaction.
- A generated, hash-bound, one-transaction driver. A mismatched schema, migration history, identity mapping, or expected row count stops before the first write.
- A Vercel maintenance pause/resume only for the later authorized write window.
- Normal repository checks and post-apply read-only proof.

The existing reconciliation deletes specific legacy metric artifacts that violate the new invariant. That deletion remains in the same transaction. It is not a full database wipe, does not touch Quote Tool, and does not delete `auth.users`.

## Current preflight result

On 2026-08-23, the authenticated production Supabase dashboard confirmed the expected pre-migration state without reading customer records: 31 public tables, history ending at `0017` and `0018`, no `0020` through `0024` feature objects, and zero Storage buckets or objects.

The previously saved direct database credential was rejected before this dashboard check. It is not needed for the dashboard route and must not be pasted into chat, repository files, or a pull request. Docker is likewise not required for this owner-authorized dashboard route.

## Required future authorization

After this plan is merged and an authenticated Supabase dashboard session confirms the current read-only state, the owner must name the exact merged `master` SHA, project ref, driver SHA-256, current migration/history result, aggregate reconciliation counts, and private identity-mapping digest.

That message must explicitly permit permanent deletion of the driver's in-scope legacy Copilot records without a recovery backup and permit pause/resume of only the Hub Vercel production project.

Any changed input invalidates the authorization. A failed compatibility check or transaction resumes Vercel and stops. It must not fall back to a manual migration, broad delete, or another database target.

## Verification after the future transaction

The post-apply proof must show canonical `0020` through `0024` schema and history, forced RLS/default-deny posture, retained password-login identity mapping, and working non-provider Hub health routes. It must not enable cron, sends, live calling, or Railway.
