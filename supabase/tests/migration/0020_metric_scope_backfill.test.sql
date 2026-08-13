begin;

create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;

select no_plan();

select is(
  (select metric_scope from public.calls where id = '80000000-0000-0000-0000-000000000201'),
  'pending',
  'an unfinished orphan call is quarantined as pending'
);

select is(
  (select metric_scope from public.calls where id = '80000000-0000-0000-0000-000000000202'),
  'performance',
  'a completed manual call has positive performance evidence'
);

select is(
  (select metric_scope from public.calls where id = '80000000-0000-0000-0000-000000000203'),
  'training',
  'a simulator-linked call remains training-only'
);

select is(
  (select metric_scope from public.calls where id = '80000000-0000-0000-0000-000000000204'),
  'performance',
  'a consumed and ended real dial has positive performance evidence'
);

select is(
  (select metric_scope from public.calls where id = '80000000-0000-0000-0000-000000000205'),
  'pending',
  'a consumed dial without original completion evidence remains excluded'
);

select is(
  (select metric_scope from public.transcripts where id = '80000000-0000-0000-0000-000000000101'),
  'performance',
  'an unlinked uploaded transcript has durable import evidence'
);

select is(
  (select metric_scope from public.transcripts where id = '80000000-0000-0000-0000-000000000102'),
  'pending',
  'an unlinked transcript without source evidence is quarantined as pending'
);

select is(
  (select metric_scope from public.transcripts where id = '80000000-0000-0000-0000-000000000103'),
  'training',
  'a transcript inherits training scope from its simulator call'
);

select is(
  (select metric_scope from public.transcripts where id = '80000000-0000-0000-0000-000000000104'),
  'performance',
  'a transcript inherits performance scope from its verified real call'
);

select is(
  (select metric_scope from public.transcripts where id = '80000000-0000-0000-0000-000000000105'),
  'performance',
  'a transcript inherits performance scope from its completed manual call'
);

select is(
  (select metric_scope from public.transcripts where id = '80000000-0000-0000-0000-000000000106'),
  'pending',
  'a transcript inherits pending scope from an incomplete dial attempt'
);

select is(
  (select metric_scope from public.call_scores where id = '80000000-0000-0000-0000-000000000401'),
  'performance',
  'an imported transcript score inherits performance scope'
);

select is(
  (select metric_scope from public.call_scores where id = '80000000-0000-0000-0000-000000000402'),
  'pending',
  'an ambiguous transcript score remains excluded as pending'
);

select is(
  (select metric_scope from public.call_scores where id = '80000000-0000-0000-0000-000000000403'),
  'training',
  'a simulator transcript score remains training-only'
);

select is(
  (select status from public.live_sessions where id = '80000000-0000-0000-0000-000000000302'),
  'completed',
  'the verified ended real dial is terminalized as completed'
);

select is(
  (select status from public.live_sessions where id = '80000000-0000-0000-0000-000000000301'),
  'abandoned',
  'the legacy simulator session is terminalized without entering performance data'
);

select is(
  (select status from public.live_sessions where id = '80000000-0000-0000-0000-000000000303'),
  'abandoned',
  'a legacy dial without original completion evidence is terminalized as abandoned'
);

select lives_ok(
  'select public.assert_personal_touch_metric_provenance()',
  'a personal-touch task backed by a positively classified transcript survives migration'
);

select * from finish();
rollback;
