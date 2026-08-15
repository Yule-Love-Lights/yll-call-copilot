-- Apply after migrations 0001..0022 and before migration 0023. This fixture
-- proves the live upgrade boundary: employee IDs already referenced by lead
-- and call ownership survive the immutable identity cutover exactly.

insert into auth.users (
  id,
  email,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new
) values
  (
    'a1000000-0000-4000-8000-000000000001',
    'legacy-office@example.invalid',
    '',
    '',
    '',
    ''
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    'legacy-owner@example.invalid',
    '',
    '',
    '',
    ''
  );

insert into public.app_users (id, email, role, created_at) values
  (
    'a2000000-0000-4000-8000-000000000001',
    ' Legacy-Office@Example.Invalid ',
    'rep',
    '2026-01-01 12:00:00+00'
  ),
  (
    'a2000000-0000-4000-8000-000000000002',
    'legacy-owner@example.invalid',
    'owner',
    '2026-01-02 12:00:00+00'
  );

insert into public.leads (
  id,
  full_name,
  phone,
  reason,
  source,
  status,
  claimed_by,
  claimed_employee_id,
  timezone
) values (
  'a3000000-0000-4000-8000-000000000001',
  'Legacy Owned Lead',
  '+15555551001',
  'identity upgrade fixture',
  'inbound',
  'claimed',
  'legacy-office@example.invalid',
  'a2000000-0000-4000-8000-000000000001',
  'UTC'
);

insert into public.calls (
  id,
  lead_id,
  rep_email,
  rep_employee_id,
  direction,
  metric_scope,
  started_at
) values (
  'a4000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'legacy-office@example.invalid',
  'a2000000-0000-4000-8000-000000000001',
  'outbound',
  'pending',
  '2026-01-03 12:00:00+00'
);
