# Shared Quote Tool Credentials, Hub-Owned Access

Status: **staging-only implementation. No environment has selected the Quote Tool identity source yet.**

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
- revocable: the service-role revoke routine removes Hub access immediately;
- audited: generic identity-link events carry `identity_source=quote_tool`;
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
4. In the Hub staging deployment only, set:

   ```text
   NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE=quote_tool
   NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL=<Quote Tool staging Auth URL>
   NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY=<Quote Tool browser-safe key>
   ```

   Keep the normal Hub Supabase URL, browser key, and service-role key because
   Hub data and authorization still use the Hub project.
   When the selected source is `quote_tool`, the two UUIDs in
   `HUB_OWNER_ADMIN_AUTH_USER_IDS` must be the approved Quote Tool Auth UUIDs
   for those same two people. Do not mix Hub Auth UUIDs with Quote Tool Auth
   UUIDs in that setting.
5. Verify: an approved mapped Office user can sign in with the existing Quote
   Tool password; an unmapped Quote Tool user receives a denial; a revoked
   mapping loses access; and switching the source back to `hub` preserves the
   existing Hub sign-in path.

## Rollback

Set `NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE=hub` on the staging deployment. To
withdraw a particular Quote Tool identity immediately, use the service-role
only `revoke_quote_tool_employee_identity` routine with an audited reason.
Do not delete or directly edit mapping rows.

## Still out of scope

This is shared credentials, not cross-site single sign-on. It intentionally
does not add phone codes, Twilio, Turnstile, Cloudflare, password recovery,
identity replacement, or production activation. Those can be decided later
without changing this bridge's permission boundary.

When Quote Tool authentication is selected, Hub password-recovery pages return
to Hub login. Password recovery remains Quote Tool-owned so the Hub cannot
change credentials for the source identity.
