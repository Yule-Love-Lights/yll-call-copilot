-- RLS: service-role only, same convention as 0001-0015.
-- Practice: a rep rehearses a call against an AI-played homeowner customer
-- (Claude, in character) and gets scored on the exact same rubric as a real
-- call (src/lib/scoring/score.ts). Rep-only -- practice scores live HERE
-- only, never in call_scores, and never surface on the scoreboard, digest,
-- or brain. turns is the running transcript as structured speaker/text
-- pairs (see src/lib/practice/types.ts); score is the same CallScoreContent
-- jsonb shape call_scores stores, kept null until POST /api/practice/[id]/end
-- successfully scores the call (or forever, if scoring degraded).
-- File only -- not applied anywhere yet, same convention as 0001-0015.

create table practice_sessions (
  id uuid primary key default gen_random_uuid(),
  rep_email text,
  vertical_slug text,
  emotional_state text not null check (emotional_state in ('excited', 'busy', 'guarded', 'status')),
  objective text,
  turns jsonb not null default '[]',
  status text not null default 'active' check (status in ('active', 'ended')),
  score jsonb,
  created_at timestamptz default now(),
  ended_at timestamptz
);
