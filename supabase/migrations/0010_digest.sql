-- RLS: service-role only, same convention as 0001-0006.
-- Phase 6 schema for YLL Call Copilot: the self-generating weekly digest.
-- A weekly_digests row is one Friday digest covering one period: team
-- trends, the three lowest-scoring dimensions (the week's training focus),
-- the best call to celebrate, the roughest moment worth a private 1:1, the
-- playbook proposals the brain review produced in the window, and a
-- role-play scenario built from the roughest real moment. Reads call_scores
-- (see migration 0008) and playbook_proposals (0003_knowledge.sql); the full
-- computed content -- stats plus everything Claude wrote -- lands in one
-- `content` jsonb column, same "one blob, not a dozen columns" shape as
-- brain_reviews.stats (0006_brain.sql).
-- The unique(period_start, period_end) constraint is what makes a run
-- idempotent per week: the cron route checks for an existing row before
-- generating, and only the manual "Generate now" route deletes and reinserts.
-- File only -- not applied anywhere yet, same convention as 0001-0006.

create table weekly_digests (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  content jsonb not null,
  created_at timestamptz default now(),
  unique (period_start, period_end)
);
