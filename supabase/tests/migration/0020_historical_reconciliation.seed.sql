insert into public.verticals (id, slug, name)
values ('80000000-0000-0000-0000-000000000001', 'reconciliation-fixture', 'Fixture');

insert into public.weekly_digests (id, period_start, period_end, content)
select
  ('81000000-0000-0000-0000-' || lpad(series.id::text, 12, '0'))::uuid,
  date '2026-01-01' + series.id * 7,
  date '2026-01-07' + series.id * 7,
  '{}'::jsonb
from generate_series(1, 5) as series(id);

insert into public.brain_reviews (
  id, vertical_id, period_start, period_end, stats, narrative
)
select
  ('82000000-0000-0000-0000-' || lpad(series.id::text, 12, '0'))::uuid,
  '80000000-0000-0000-0000-000000000001'::uuid,
  date '2026-01-01' + series.id,
  date '2026-01-02' + series.id,
  '{}'::jsonb,
  'fixture'
from generate_series(1, 9) as series(id);

insert into public.playbook_proposals (
  id, vertical_id, section, kind, proposed_value, evidence
)
select
  ('83000000-0000-0000-0000-' || lpad(series.id::text, 12, '0'))::uuid,
  '80000000-0000-0000-0000-000000000001'::uuid,
  'fixture-' || series.id,
  'add',
  '{}'::jsonb,
  'fixture'
from generate_series(1, 14) as series(id);

insert into public.second_mile_touches (
  id, kind, payload, dedupe_key
) values (
  '85000000-0000-0000-0000-000000000001',
  'personal_touch',
  '{}'::jsonb,
  'reconciliation-unsafe-touch-fixture'
);

set session_replication_role = replica;
insert into public.call_scores (
  id,
  transcript_id,
  rubric_version,
  emotional,
  sales,
  hospitality,
  hard_metrics,
  experience,
  experience_score,
  overall,
  win
) values (
  '86000000-0000-0000-0000-000000000001',
  '86000000-0000-0000-0000-000000000099',
  1,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  0,
  0,
  'fixture'
);
set session_replication_role = origin;

insert into public.feedback_cards (
  id, call_score_id, card
) values (
  '87000000-0000-0000-0000-000000000001',
  '86000000-0000-0000-0000-000000000001',
  '{}'::jsonb
);
