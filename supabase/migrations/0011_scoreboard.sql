-- RLS: service-role only, same convention as 0001-0006.
-- Workstream 5 schema: the transparency scoreboard's visibility switch.
-- Reads call_scores (0008, a sibling migration — the after-every-call coach's
-- scored rows) but owns no columns on it; this migration only adds the
-- single settings row the scoreboard reads to decide who sees what.
-- File only — not applied anywhere yet, same convention as 0001-0006.

-- Singleton settings row (id always 1 — enforced by the CHECK, not a second
-- table or a key-value store, since there is exactly one team-wide switch).
-- team_board_enabled false = onboarding: reps see only their own row/trends
-- (docs/SALES-EXCELLENCE-PLAN.md "two-week private self-review" rollout).
-- onboarding_started_at tracks when the current private period began, so the
-- UI can nudge the owner once two weeks are up — a suggestion, never
-- automatic; the switch only ever flips on an explicit POST.
create table coach_settings (
  id int primary key default 1 check (id = 1),
  team_board_enabled boolean not null default false,
  onboarding_started_at date,
  updated_at timestamptz default now()
);

insert into coach_settings (id, team_board_enabled, onboarding_started_at)
values (1, false, null)
on conflict (id) do nothing;
