-- RLS: service-role only, same convention as 0001-0006.
-- Workstream 3 schema for YLL Call Copilot: automated rep feedback cards.
-- One feedback_cards row per scored call (call_score_id unique), holding the
-- glanceable card GET /api/feedback lazily derives from call_scores via
-- src/lib/feedback/card.ts's deriveCard() the first time a rep's feed is
-- read after that call is scored -- no cron needed for a card to exist
-- "minutes after each call." praise_only mirrors card.fix === null so the UI
-- can tell at a glance whether a card carries a fix section without
-- inspecting the jsonb. seen_at is stamped by POST
-- /api/feedback/[id]/seen the first time a rep opens a card.
-- References call_scores from migration 0008 (the sibling rep-scoring
-- workstream) -- 0008 must be applied before this file.
-- File only -- not applied anywhere yet, same convention as 0001-0006.

create table feedback_cards (
  id uuid primary key default gen_random_uuid(),
  call_score_id uuid not null unique references call_scores(id) on delete cascade,
  transcript_id uuid,
  rep_email text,
  praise_only boolean not null default false,
  card jsonb not null,
  seen_at timestamptz,
  created_at timestamptz default now()
);
