-- Apply after migrations 0001..0022 and before migration 0023. Two raw Auth
-- emails normalize to the one legacy email, so no UUID may be guessed.

insert into auth.users (
  id,
  email,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new
) values
  (
    'b3000000-0000-4000-8000-000000000001',
    'ambiguous@example.invalid',
    '',
    '',
    '',
    ''
  ),
  (
    'b3000000-0000-4000-8000-000000000002',
    ' AMBIGUOUS@EXAMPLE.INVALID ',
    '',
    '',
    '',
    ''
  );

insert into public.app_users (id, email, role) values (
  'b3000000-0000-4000-8000-000000000003',
  'ambiguous@example.invalid',
  'office'
);
