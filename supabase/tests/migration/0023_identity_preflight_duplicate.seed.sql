-- Apply after migrations 0001..0022 and before migration 0023. The raw email
-- values differ, but normalization reveals two legacy rows for one person.

insert into auth.users (
  id,
  email,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new
) values (
  'b2000000-0000-4000-8000-000000000001',
  'duplicate@example.invalid',
  '',
  '',
  '',
  ''
);

insert into public.app_users (id, email, role) values
  (
    'b2000000-0000-4000-8000-000000000002',
    'duplicate@example.invalid',
    'office'
  ),
  (
    'b2000000-0000-4000-8000-000000000003',
    ' DUPLICATE@EXAMPLE.INVALID ',
    'rep'
  );
