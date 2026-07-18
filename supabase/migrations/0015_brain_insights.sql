-- RLS: service-role only, same convention as 0001-0014.
-- "Seed the Brain": the operator teaching the app's knowledge base directly,
-- either by typing a manual insight (src/app/api/brain/insights/route.ts)
-- or by answering the guided interview (src/lib/brain/interview.ts), which
-- one Claude call then distills into insights here
-- (src/lib/brain/distillInterview.ts, source='interview'). vertical_id is
-- nullable: null means the insight applies to the whole business rather
-- than one line of business.
--
-- A sibling PR's Brain view reads this table by lens; that PR degrades
-- gracefully via isMissingTableError (src/lib/supabase.ts) if this
-- migration is not yet applied, so nothing breaks regardless of which PR
-- lands first.
--
-- File only -- not applied anywhere yet, same convention as 0001-0014.

create table brain_insights (
  id uuid primary key default gen_random_uuid(),
  vertical_id uuid references verticals(id) on delete set null,
  source text not null check (source in ('interview', 'manual')),
  lens text not null check (lens in ('market', 'leads', 'coaching', 'general')),
  title text not null,
  content text not null,
  created_by text,
  created_at timestamptz default now()
);
