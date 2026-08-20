# Phase 0 database default-deny runbook

Status: **production `0019` applied out of band and verified; staging rehearsal and `0020`-`0024` pending**
Date: 2026-08-20

This runbook covers the Hub-owned Supabase database only. It does not create
Quote-owned time, pay, job, payroll, or shared-labor tables, and it does not
authorize Advertising or Installer accounts.

Production currently has the 31 pre-`0020` public application tables. Migration
`0019` was applied out of band and the RLS/grant state was verified live across
those tables. This does not substitute for the required staging rehearsal, and
it does not authorize applying migrations `0020` through `0024` to production.
The separate paid staging Supabase project has not been created.

## 1. Enforced architecture

The legacy Office application is API-only for application data:

- browser Supabase clients may use the Auth service;
- `anon` and `authenticated` have no `public` schema usage, table/column DML,
  sequence privileges, or RLS allow policies;
- server handlers use the server-only `service_role` client after Hub
  capability and resource checks;
- every current application table has RLS enabled and forced;
- future public tables, sequences, and functions start inaccessible to every
  API role until a reviewed migration explicitly opts them in.

`service_role` bypasses RLS. Therefore this migration is defense in depth, not
a replacement for handler-level capability, ownership, and audit checks.

## 2. What CI proves

The `database-security` job starts a clean PostgreSQL 17 Supabase database,
applies every checked-in migration, and runs pgTAP with real `SET ROLE`
impersonation.

It proves:

- the exact current manifest contains 38 non-extension application tables and two
  identity sequences;
- no unreviewed application view, materialized view, foreign table, routine,
  non-internal trigger, policy, or publication path exists in the clean schema;
- all 38 tables enable and force RLS with zero client policies;
- `anon` and `authenticated` lack schema, table, column, and sequence access;
- a transaction-local grant cannot overcome RLS default deny;
- arbitrary caller-supplied JWT persona claims cannot overcome database
  default deny;
- `service_role` retains current DML but not truncate/schema-create/sequence-
  reset privileges;
- future public objects receive no automatic API-role access.

The current clean target also contains 30 public routines and 12 non-internal
triggers. Claims-shaped tests are not employee-policy tests. Inactive state,
immutable self linkage, multi-membership departments, membership versions,
Owner/Admin, and Manager behavior require server-plus-database semantic persona
tests against the merged additive Hub identity schema.

## 3. What clean CI does not prove

Clean CI cannot inspect a hosted project for manually created objects, owners,
grants, policies, publications, or data-dependent locking. It also does not
prove the hosted PostgreSQL major version or exercise PostgREST with real API
keys.

Before hosted rollout, record and review the following read-only results in
staging and production:

```sql
select current_user, current_setting('server_version') as server_version;

select rolname, rolsuper, rolbypassrls, rolinherit, rolcanlogin
from pg_roles
where rolname in (
  current_user,
  'postgres',
  'anon',
  'authenticated',
  'service_role',
  'authenticator'
)
order by rolname;

select
  n.nspname,
  c.relname,
  c.relkind,
  pg_get_userbyid(c.relowner) as owner,
  c.relrowsecurity,
  c.relforcerowsecurity,
  c.relacl
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
order by c.relkind, c.relname;

select table_name, grantee, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
order by table_name, grantee, privilege_type;

select table_name, column_name, grantee, privilege_type
from information_schema.column_privileges
where table_schema = 'public'
order by table_name, column_name, grantee, privilege_type;

select *
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

select
  p.oid::regprocedure as routine,
  pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer,
  p.proleakproof,
  p.proacl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by routine::text;

select
  c.relname as table_name,
  t.tgname,
  pg_get_triggerdef(t.oid, true) as definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and not t.tgisinternal
order by c.relname, t.tgname;

select publication.pubname, publication.puballtables
from pg_publication publication
order by publication.pubname;

select publication.pubname, namespace.nspname
from pg_publication_namespace publication_namespace
join pg_publication publication
  on publication.oid = publication_namespace.pnpubid
join pg_namespace namespace
  on namespace.oid = publication_namespace.pnnspid
order by publication.pubname, namespace.nspname;

select pubname, schemaname, tablename
from pg_publication_tables
where schemaname = 'public'
order by pubname, tablename;

select
  pg_get_userbyid(default_acl.defaclrole) as owner,
  namespace.nspname,
  default_acl.defaclobjtype,
  default_acl.defaclacl
from pg_default_acl default_acl
left join pg_namespace namespace
  on namespace.oid = default_acl.defaclnamespace
where namespace.nspname = 'public' or default_acl.defaclnamespace = 0
order by owner, namespace.nspname, default_acl.defaclobjtype;
```

Stop before migration if review finds:

- an unexpected non-extension relation, sequence, routine, trigger, policy, or
  publication path;
- an unexpected owner or inherited grant;
- a `SECURITY DEFINER` routine callable by a user-facing role;
- a `service_role` without `BYPASSRLS`;
- a PostgreSQL major version different from `supabase/config.toml`;
- a Hub table used by an unrecorded external consumer.

## 4. Rollout order

1. Deploy the merged fail-closed auth and capability gates first.
2. Run and archive the hosted read-only preflight.
3. Resolve every drift item; do not weaken migration assertions to make drift
   disappear.
4. Snapshot or back up the hosted database.
5. Apply the migration to a staging clone containing current-state data.
6. Run the pgTAP suite plus authenticated sign-in/recovery, representative
   Office reads/writes, cron, HighLevel, Twilio, and live-bridge smokes.
7. Apply production during a low-traffic window. The five-second lock timeout
   must roll back rather than wait on a busy table.
8. Repeat signed smokes and monitor permission errors and failed service writes.

If a server path loses needed access, keep user roles denied and apply a
targeted forward migration granting only the missing `service_role` operation.
Do not roll back by disabling RLS or restoring `anon`/`authenticated` access.

## 5. Remaining release gates

- Close every service-role handler ownership/resource gap.
- Preserve the merged immutable Hub employee/auth links, active state,
  department memberships, membership versioning, and local identity audit;
  implement the runtime inbox/outbox/DLQ and supported-version envelope against
  the published and vendored canonical schema.
- Add real persona and cross-employee impersonation tests against that schema.
- Create the separate paid staging Supabase project and rehearse migrations
  `0020` through `0024` there before any production application.
- Land the Quote-owned current-context projection; do not invent it in the Hub.
- Confirm the hosted PostgreSQL major version and run a full-stack Data API
  denial smoke.
- Keep Advertising and Installer provisioning blocked until those gates and
  the applicable owner decisions pass.
