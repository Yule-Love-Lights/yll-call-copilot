-- Apply after migrations 0001..0022 and before migration 0023. The legacy
-- allowlist row deliberately has no normalized auth.users match.

insert into public.app_users (id, email, role) values (
  'b1000000-0000-4000-8000-000000000001',
  'missing-auth@example.invalid',
  'office'
);
