# Office Tasks production release runbook

Status: **prepared only; no production application yet**

This runbook releases only the Hub-owned manual Office Tasks foundation at the
approved Hub revision. It is not authority to apply a different revision,
`0025_quote_tool_identity_bridge.sql`, a general migration command, or any
provider, phone-auth, customer-send, live-call, cron, or Quote Tool change.

## Exact target

- Migration: `supabase/migrations/20260821141530_office_tasks.sql`
- Migration SHA-256:
  `dc53110c349f4864725531adb9295707a6d5140c037885f1863d58a8be1347a2`
- Required command: `node scripts/release-office-tasks.mjs`

The release runner refuses staging, validates the protected database target and
Supabase CA, requires the exact checked-in migration set, and rejects any state
other than:

1. canonical history through `0024`, followed by the exact separately approved
   timestamped production identity-history records
   `20260825130719_quote_tool_identity_bridge` and
   `20260825130728_production_quote_tool_identity_activation`, with no Office
   Tasks objects;
2. that same history with the complete Office Tasks objects, which is the only
   supported recovery state after a connection loss; or
3. that same history plus Office Tasks with the complete Office Tasks objects.

It does not accept a partial schema or any other history shape. The timestamped
production identity history intentionally differs from the checked-in identity
source filenames, so a general `supabase db push` remains prohibited.

## Required operator environment

Set these values only in a protected local environment. Do not place their
values in the repository, shell history, chat, tickets, or process arguments.

- `YLL_MIGRATION_ENVIRONMENT=production`
- `YLL_EXPECTED_SUPABASE_PROJECT_REF`
- `SUPABASE_DB_URL`
- `YLL_SUPABASE_SSL_ROOT_CERT`
- `YLL_EXPECTED_SUPABASE_SSL_ROOT_CERT_SHA256`

The existing target guard requires PostgreSQL 17 on macOS or Linux/WSL and
`sslmode=verify-full` with the separately reviewed CA. Native Windows is not a
supported runner platform.

## Execution

After a new exact production-write authorization names the repository revision,
migration filename, migration SHA-256, target database, and exclusion of
`0025`, run the one reviewed command from the approved Hub checkout:

```sh
node scripts/release-office-tasks.mjs
```

The runner performs the following in order:

1. verifies current source bytes and the production-only target;
2. reads migration history and the Office Tasks object state;
3. applies a byte-verified, generated driver containing only the reviewed
   Office Tasks migration if the schema is absent;
4. records only the Office Tasks migration in Supabase history, including the
   supported recovery path when the schema committed but history marking did
   not;
5. checks forced RLS, zero browser policies, RPC privileges, and object shape;
6. confirms a normal dry run reports only the two known identity source
   migrations. Those files were already applied through separately approved
   timestamped production-history records; the dry run is evidence only and
   must never be followed by a general `supabase db push`.

The command stops before a write on any unexpected target, certificate,
history, schema, or dry-run result. It prints no connection string or secret.

## After database proof

Only after the runner reports `OFFICE_TASKS_RELEASE_OK`:

1. verify password login and ordinary non-provider Office access;
2. with an existing authorized Office identity, create a manual task, block it
   with a reason, and complete or dismiss it as permitted;
3. confirm a different Office identity cannot update that task;
4. repeat a request with the same idempotency key and verify the original
   result is returned; verify a reused key with a different payload is rejected;
5. verify terminal tasks and audit events cannot change; and
6. test the Office task UI at desktop and mobile widths while all unrelated
   outbound switches remain disabled.

Stop and re-pause the application if password login or approved Office reads
fail. Do not test customer sends, calls, provider delivery, recovery, or cron
under this runbook.
