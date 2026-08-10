-- Ledger #221 follow-up: defense in depth after the RLS lockdown (0017).
--
-- 0017 enabled RLS on every public table with no policies, which is a genuine
-- default-deny for anon/authenticated (verified: neither role has rolbypassrls,
-- table owner is postgres, pg_policies is empty). But RLS does NOT revoke
-- table-level GRANTs, and both roles still hold ALL PRIVILEGES
-- (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) on all 31 public
-- tables. Nothing is exposed today, but that grant floor means ONE future
-- over-broad policy (a `USING (true)` added to solve some later problem)
-- reopens full read/write instantly rather than granting only what was
-- intended. Revoking makes a future policy mistake fail safe.
--
-- Two halves, and the second is the one that is easy to miss: Supabase's
-- DEFAULT PRIVILEGES re-grant ALL on every table created in the future, so a
-- revoke of today's grants alone would silently undo itself on the next
-- migration that adds a table.
--
-- service_role is deliberately untouched: it bypasses RLS but still needs its
-- grants, and it is the only path the app's data layer uses.
--
-- Reversible: re-run the equivalent GRANT statements if some future feature
-- genuinely needs anon or authenticated table access (it would also need an
-- explicit RLS policy, which is the point).

-- 1. Existing tables.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- 2. Future tables created by postgres — the role migrations actually run as,
-- so this is the one that covers future APP tables.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

-- KNOWN RESIDUAL, deliberately not in this migration. `supabase_admin` also
-- carries a default ACL granting ALL to anon/authenticated on tables IT creates
-- in public. Revoking it fails with "42501: permission denied to change default
-- privileges" when connected as postgres, which is the highest role available
-- through the migration path. Impact is limited: application migrations create
-- tables as postgres (covered above), so this only affects tables Supabase's own
-- tooling creates in the public schema. Those would still be RLS-gated
-- separately. Left explicit here rather than silently dropped — if a future
-- Supabase-created public table ever holds real data, check its grants by hand:
--   select defaclacl from pg_default_acl d join pg_namespace n
--     on n.oid = d.defaclnamespace where n.nspname='public';
--
-- APPLIED 2026-08-07 (statements 1 and 2 only), verified after: anon and
-- authenticated hold 0 table grants in public, service_role retains all 31.
