-- Apply after migrations 0001..0022 and before migration 0023. The mapping is
-- otherwise exact, but its normalized email is not a compatibility address.

insert into auth.users (
  id,
  email,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new
) values (
  'b4000000-0000-4000-8000-000000000001',
  'malformed-email',
  '',
  '',
  '',
  ''
);

insert into public.app_users (id, email, role) values (
  'b4000000-0000-4000-8000-000000000002',
  'malformed-email',
  'office'
);
