-- RLS: service-role only, same convention as 0001-0005.
-- Phase 5 schema for YLL Call Copilot: the compounding brain. A brain_review
-- row is one "Run weekly review" click (or scheduled run) for one vertical:
-- the period it covers, the stats computed for that period (see
-- src/lib/analytics/stats.ts), the plain-English narrative Claude wrote from
-- them, and how many playbook_proposals it produced (the proposals
-- themselves land as ordinary playbook_proposals rows -- see
-- src/app/api/verticals/[id]/brain-review/route.ts -- so the existing
-- approve/reject plumbing from 0003_knowledge.sql handles them unchanged).
-- File only -- not applied anywhere yet, same convention as 0001-0005.

create table brain_reviews (
  id uuid primary key default gen_random_uuid(),
  vertical_id uuid references verticals(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  stats jsonb not null,
  narrative text not null,
  proposals_created int not null default 0,
  created_at timestamptz default now()
);
