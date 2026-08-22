# Shared Quote Tool Credentials, Hub-Owned Access

Status: **staging source selected; password sign-in verified; mappings are static; production activation blocked**

This bridge lets an approved staff member sign into the Operations Hub with the
same existing Quote Tool email and password. The applications, databases,
sessions, employee records, and permissions remain separate.

The Quote Tool confirms the password. The Hub independently decides whether
that authenticated Quote Tool user is an active staff member and what they may
do. An email match alone never grants Hub access.

## What migration 0025 adds

`0025_quote_tool_identity_bridge.sql` adds a versioned external-auth mapping
from a Quote Tool Auth UUID to one Hub employee. It is:

- explicit: only the service-role link routine may create it;
- immutable: the source UUID and employee association cannot be edited;
- revocable: the service-role revoke routine blocks subsequent actor
  resolution; an already resolved request can still finish as described below;
- recorded: generic identity-link events carry `identity_source=quote_tool`
  and the operator-supplied reason, but they do not yet identify the acting
  owner/operator;
- separate: no Quote Tool password, service key, or employee data is copied to
  the Hub browser or database.

The normal Hub Auth link remains the default and is unchanged. Selecting Quote
Tool authentication does not provision Advertising, Installer, or Manager
access, and it does not change Hub role or membership rules.

## Staging rollout

1. Apply migration `0025` to the isolated Hub staging database and run the
   database/default-deny suites.
2. On a secure operator machine only, configure the four server variables
   named by `npm run link:quote-tool-identity`. Do not add the Quote Tool
   service-role key to a Hub staging identity configuration or any
   `NEXT_PUBLIC_*` variable.
3. Confirm the existing Quote Tool staff account and existing active Hub
   employee through the approved staff process, then run:

   ```sh
   npm run link:quote-tool-identity -- <staff-email>
   ```

   The command never creates either account and prints no identifier. It
   makes one explicit mapping using the service-role-only Hub routine.
4. In the Hub Vercel Preview deployment only, confirm Vercel supplies exactly
   `VERCEL_ENV=preview`, then set:

   ```text
   NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE=quote_tool
   NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL=https://chhntsbnbofyqrpivuog.supabase.co/
   NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY=<Quote Tool browser-safe key>
   ```

   The frozen Quote Tool Auth project ref is `chhntsbnbofyqrpivuog`. Do not use
   another Quote Tool or Supabase project URL. Deployment preflight accepts
   only exact `VERCEL_ENV=preview` or `VERCEL_ENV=production`; a missing, blank,
   or unknown value fails closed. Quote Tool identity selection and its two
   public configuration variables are accepted only in Preview.
   Keep the normal Hub Supabase URL, browser key, and service-role key because
   Hub data and authorization still use the Hub project.
   When the selected source is `quote_tool`, the two UUIDs in
   `HUB_OWNER_ADMIN_AUTH_USER_IDS` must be the approved Quote Tool Auth UUIDs
   for those same two people. Do not mix Hub Auth UUIDs with Quote Tool Auth
   UUIDs in that setting.
   Ordinary non-staging previews do not receive this branch-scoped auth bundle.
   They may build only in the explicit `unconfigured_preview` mode, where
   protected requests remain unavailable with a generic 503. Supplying any
   partial Hub or Quote auth bundle still fails deployment preflight.
5. Staging has verified that approved mapped users can sign in with their
   existing Quote Tool email/password. The current two mappings remain active
   and static. The unmapped-user, revocation, replacement, and rollback smokes
   remain blocked until the source-aware transaction checks below exist.

Do not call `revoke_quote_tool_employee_identity` and then link a different
Quote Tool UUID for the same employee. The current `0020` employee mutation
routines do not revalidate the source-specific Auth UUID inside their database
transaction. A request resolved immediately before revocation could therefore
finish afterward. Initial link and exact retry are the only approved staging
operator actions for now.

## Rollback

In one reviewed staging configuration change, set
`NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE=hub` and restore
`HUB_OWNER_ADMIN_AUTH_USER_IDS` to the approved Hub Auth UUIDs. Verify both
owners can sign in through Hub Auth before calling rollback complete. Do not
leave Quote Tool UUIDs in the owner ceiling after switching the source.

Emergency withdrawal of a Quote Tool identity is a separate reviewed database
write. If authorized, use only the service-role
`revoke_quote_tool_employee_identity` routine with a nonblank reason, keep the
Hub source selected during investigation, and never delete or directly edit
mapping rows. Do not link a replacement identity afterward under the current
schema.

## Still out of scope

This is shared credentials, not cross-site single sign-on. It intentionally
does not add phone codes, Twilio, Turnstile, Cloudflare, password recovery,
identity replacement, or production activation. Before replacement or
production activation, all employee mutation routines must atomically verify
the selected identity source, exact Auth UUID, active employee, and current
membership. Replacement must be one owner-authenticated transaction that
records the acting owner and reason.

Password login remains the selected method. Deployment preflight rejects
`HUB_PHONE_AUTH_STAGING_ENABLED=true` and rejects any configured
`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, so phone auth and Turnstile activation are
deployment-blocked while this decision remains in force.

When Quote Tool authentication is selected, Hub password-recovery pages return
to Hub login. Password recovery remains Quote Tool-owned so the Hub cannot
change credentials for the source identity.
