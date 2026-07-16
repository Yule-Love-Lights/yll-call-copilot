-- RLS: service-role only, same convention as 0001-0006.
-- Workstream 7 schema: the second-mile journey as a task queue. Reveal-photo
-- prompts, personal touches flagged from call transcripts, the December
-- 10-25 cookies + custom ornament run, and proactive first-cold-snap
-- check-ins all land here as rows a human works from and marks done/skipped
-- -- nothing in this file or the code that reads it ever auto-sends to a
-- customer or crew member. File only -- not applied anywhere yet, same
-- convention as 0001_init.sql through 0006_brain.sql.

create table second_mile_touches (
  id uuid primary key default gen_random_uuid(),
  ghl_contact_id text,
  customer_name text,
  kind text not null check (kind in ('reveal_photo', 'personal_touch', 'cookies_ornament', 'cold_snap_checkin')),
  status text not null default 'pending' check (status in ('pending', 'done', 'skipped')),
  due_at timestamptz,
  payload jsonb,
  -- Convention (pinned in src/lib/secondMile/candidates.ts, unit-tested):
  --   reveal_photo:      `reveal_photo:${ghl_contact_id}`
  --   cookies_ornament:  `cookies_ornament:${ghl_contact_id}:${yyyy}`
  --   cold_snap_checkin: `cold_snap_checkin:${ghl_contact_id}:${yyyy}`
  --   personal_touch:    `personal_touch:${transcript_id}:${hash-of-detail}`
  -- The unique constraint is what makes the nightly cron idempotent: a
  -- second run inserting the same candidate rows hits on-conflict-do-nothing
  -- (supabase-js upsert with ignoreDuplicates) and adds zero new rows.
  dedupe_key text unique not null,
  created_at timestamptz default now(),
  done_at timestamptz,
  done_by text
);

-- Tracks which transcripts the nightly personal-touch scan has already
-- processed, so a transcript created 4 days ago (outside the "last 3 days"
-- window the cron pulls) or one already scanned yesterday never gets
-- re-scanned and never double-bills the Claude call. transcript_id is the
-- primary key rather than a separate uuid + unique column -- one scan record
-- per transcript, ever.
create table second_mile_scans (
  transcript_id uuid primary key references transcripts(id) on delete cascade,
  scanned_at timestamptz default now(),
  touches_found int not null default 0
);
