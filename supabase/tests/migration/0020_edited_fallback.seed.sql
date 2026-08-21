insert into public.verticals (id, slug, name, active_version)
values ('88000000-0000-0000-0000-000000000001', 'edited-fallback-fixture', 'Fixture', 2);

insert into public.playbook_versions (
  id, vertical_id, version, content, source
) values
  (
    '88100000-0000-0000-0000-000000000001',
    '88000000-0000-0000-0000-000000000001',
    1,
    '{}'::jsonb,
    'generated'
  ),
  (
    '88200000-0000-0000-0000-000000000001',
    '88000000-0000-0000-0000-000000000001',
    2,
    '{}'::jsonb,
    'edited'
  );
