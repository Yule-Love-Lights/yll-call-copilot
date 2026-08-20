# Staging phone-auth deployment gate

Status: **staging branch only; production and field provisioning blocked**

This runbook activates invite-only phone OTP only for the exact Vercel Preview
deployment built from Git branch `staging`. The branch name is hard-coded in
the runtime and deployment verifier. An environment variable cannot authorize
a different branch.

## 1. Remove inherited Preview credentials first

Vercel branch-specific variables inherit generic Preview variables that are not
overridden. The current generic Preview environment must not retain production
database access.

In Vercel Project Settings, remove these variables from the generic Preview
scope before adding any `staging` override:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `HUB_STAGING_SUPABASE_PROJECT_REF`
- `QUOTE_TOOL_SUPABASE_URL`
- `QUOTE_TOOL_SUPABASE_SERVICE_ROLE_KEY`

Keep production values scoped only to Production. Non-staging preview branches
must receive no Supabase service-role or Quote Tool database credential. The
build verifier rejects the known production Hub URL, but no local check can
reliably identify an inherited production service-role token. The scope cleanup
is therefore a mandatory human deployment gate.

## 2. Configure the separate staging Supabase project

Use a separate hosted Supabase project. Never use production project
`mjmociuxxxwxvasnpxav`.

Before deployment:

1. Apply the reviewed schema and RLS migrations to staging and run the complete
   impersonated-role suite.
2. Create only the two approved Naldo/Jason test identities and record their
   staging Auth UUIDs. Do not provision Advertising or Installer accounts.
3. Disable public user signup. The application sends phone OTP with
   `shouldCreateUser: false`.
4. Enable the Phone provider and configure Twilio Verify inside Supabase Auth.
   Twilio provider secrets never belong in Vercel.
5. Enable Cloudflare Turnstile enforcement in Supabase and configure its secret
   there. Put only the public site key in Vercel.
6. Review SMS rate limits, OTP expiry, allowed phone countries, Auth redirect
   URLs, and a short access-token lifetime. The Hub separately rejects a phone
   session older than 30 days.
7. Keep a Supabase-console Owner break-glass path and document session
   revocation before the first test login.

## 3. Add only `staging` branch variables in Vercel

Add these values to Preview with Git Branch set exactly to `staging`:

- `HUB_PHONE_AUTH_STAGING_ENABLED=true`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `HUB_STAGING_SUPABASE_PROJECT_REF` for the same separate staging project
- `NEXT_PUBLIC_SUPABASE_URL` for the separate staging project
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` for that same project, using either a
  publishable key or the legacy JWT whose role is `anon`
- `SUPABASE_SERVICE_ROLE_KEY` for that same project, using either a secret key
  or the legacy JWT whose role is `service_role`
- `HUB_OWNER_ADMIN_AUTH_USER_IDS` with exactly two unique staging Auth UUIDs
- `LIVE_CUSTOMER_CALLS_ENABLED=false`
- `GHL_SEND_ENABLED=false`
- `GHL_FOLLOWUP_SEND_ENABLED=false`
- `CRON_ENABLED=false`

Do not configure either `QUOTE_TOOL_SUPABASE_*` value on this branch. Confirm
that Vercel system variables are available so the build and runtime both see
`VERCEL_ENV=preview` and `VERCEL_GIT_COMMIT_REF=staging`.

## 4. Build and smoke gates

`vercel.json` runs `npm run build:vercel` on every deployment. That command
runs `npm run verify:staging-deploy` before `next build`. Phone auth set to
`true` fails the build unless the exact branch/environment, staging Supabase,
Turnstile, two-owner, four-disabled-switch, and no-Quote-credential contract is
complete. The server-only `HUB_STAGING_SUPABASE_PROJECT_REF` must be a hosted
Supabase project ref, cannot be the known production ref, and must match the
host in `NEXT_PUBLIC_SUPABASE_URL`. The verifier reports field names only, not
configured values. It also rejects malformed, whitespace-wrapped, elevated,
or swapped browser/server Supabase key types. Missing or exact `false` phone
auth leaves local, Production, and unrelated Preview builds unchanged.

After a successful `staging` deployment:

1. Confirm a different preview branch does not display phone login.
2. Confirm `staging` displays phone login and Turnstile.
3. Confirm an unknown phone receives the same submitted response but no account
   is created.
4. Sign in each approved test identity by OTP and verify immutable actor and
   Owner/Admin ceiling resolution.
5. Verify password-authenticated, anonymous, expired, wrong-phone, revoked, and
   older-than-30-day sessions fail closed before actor resolution.
6. Verify customer calling, both HighLevel send paths, and all scheduled jobs
   remain disabled.

Attach the Vercel deployment ID, commit SHA, staging project reference, CI
results, provider screenshots without secret values, and signed smoke results
to the Phase 0 evidence. This does not authorize production phone auth or field
accounts.

## 5. Rollback

Set the branch-scoped `HUB_PHONE_AUTH_STAGING_ENABLED` value to exact `false`,
redeploy `staging`, and revoke all staging Auth sessions from Supabase. Disable
the staging Phone provider after session revocation if provider rollback is
also required. Never point the branch at production credentials as a fallback.
