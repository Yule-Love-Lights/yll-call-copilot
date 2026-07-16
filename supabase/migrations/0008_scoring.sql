-- RLS: service-role only, same convention as 0001-0007.
-- Phase 6 schema for YLL Call Copilot: the after-every-call scoring engine
-- (see docs/SALES-EXCELLENCE-PLAN.md sections 3 + 4). rubric_versions is a
-- version history of the two-sided, experience-weighted scorecard, edited
-- and versioned the same way playbook_versions works (0002_playbooks.sql):
-- content jsonb + version int + a source check, active rubric = highest
-- version, an edit inserts a new version rather than mutating history.
-- call_scores is one row per scored transcript -- the jsonb column shapes
-- are a pinned contract read by sibling workstreams building the rep
-- digest, the weekly digest, and the leaderboard (0009-0011, applied after
-- this one in numeric order): never rename a key in emotional / sales /
-- hospitality / hard_metrics / experience / guarantees without updating
-- every reader. File only -- not applied anywhere yet, same convention as
-- 0001-0007.

create table rubric_versions (
  id uuid primary key default gen_random_uuid(),
  version int not null unique,
  content jsonb not null,
  source text not null check (source in ('seeded', 'edited')),
  created_at timestamptz default now()
);

create table call_scores (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references transcripts(id) on delete cascade unique,
  rubric_version int not null,
  rep_email text,
  vertical_slug text,
  called_at timestamptz,
  emotional jsonb not null,
  sales jsonb not null,
  hospitality jsonb not null,
  hard_metrics jsonb not null,
  experience jsonb not null,
  experience_score numeric not null,
  guarantees jsonb,
  overall numeric not null,
  win text not null,
  fix jsonb,
  scored_at timestamptz default now()
);

create index call_scores_rep_email_idx on call_scores(rep_email);
create index call_scores_scored_at_idx on call_scores(scored_at);

-- Seed rubric version 1 -- the default two-sided scorecard distilled from
-- the plan's phone standard (section 3) and after-call coach spec (section
-- 4). Dollar-quoted so none of the apostrophes in the instructions need
-- escaping.
insert into rubric_versions (version, content, source) values (
  1,
  $rubric$
  {
    "master": "Read which of the four emotional states the customer is in inside the first thirty seconds: excited (run the vision-first track), busy (run the done-for-you track), guarded (run the proof-and-guarantees track), or status-driven (run the ambition-match track). Name the state back to the customer in your own words, then run the matching track. This is graded on its own, before discovery, because it is the master skill that decides whether the rest of the call lands.",
    "sales": [
      {
        "key": "opening",
        "name": "Opening and rapport",
        "weight": 15,
        "instructions": "Branded warm greeting: company name, the rep's first name, an open question. Never a bare hello. Get the caller's name early and use it once or twice naturally, not on every line."
      },
      {
        "key": "discovery",
        "name": "Discovery depth",
        "weight": 25,
        "instructions": "Ask two or three real discovery questions before any numbers, including the emotional why: what is the occasion, what would it look like done right, what matters most to them. Acknowledge before answering ('that makes sense', 'I hear you') instead of jumping straight to a response."
      },
      {
        "key": "value",
        "name": "Value presentation and price confidence",
        "weight": 20,
        "instructions": "Build value before price: raise the dream outcome and the proof (photos, guarantees, past jobs on their street), lower the perceived time and effort. Never blurt a price cold and never dodge it either; state the number level and unhurried once value is built."
      },
      {
        "key": "objections",
        "name": "Objection handling",
        "weight": 20,
        "instructions": "Use the playbook's approved responses. Treat 'let me think about it' as a discovery gap, not a rejection -- ask one more question to find the real hesitation instead of accepting it at face value."
      },
      {
        "key": "close",
        "name": "Close",
        "weight": 20,
        "instructions": "Ask for the booking with a binary choice ('Tuesday morning or Thursday afternoon, which is better'). Confirm every decision-maker will be there. Recap the booking back: name, address, window, what happens next."
      }
    ],
    "hospitality": [
      {
        "key": "greeting",
        "name": "Greeting quality and warmth",
        "weight": 20,
        "instructions": "A warm, branded, unhurried opening. The caller should feel like a person, not a ticket number."
      },
      {
        "key": "listening",
        "name": "Active listening",
        "weight": 20,
        "instructions": "Acknowledgment phrases used, the customer never talked over or rushed. Count interruptions as a hard number, not a vibe."
      },
      {
        "key": "courtesy",
        "name": "Courtesy language",
        "weight": 20,
        "instructions": "The my-pleasure standard: 'may I place you on a brief hold' not 'hold on', 'my pleasure' not 'no problem'. Never short or curt, even on a no."
      },
      {
        "key": "dead_air",
        "name": "Dead air and interruptions",
        "weight": 20,
        "instructions": "Measure actual seconds of silence and interruption counts, not impression. Long dead air reads as the rep being lost or distracted."
      },
      {
        "key": "warm_ending",
        "name": "Warm ending",
        "weight": 20,
        "instructions": "End every call warmly, especially the noes. The last 15 seconds shape the whole call's memory. Personalize the close with something the customer said and leave the door open by name."
      }
    ],
    "experience": {
      "instructions": "A 10 out of 10 call leaves the customer feeling three things at once: genuinely cared for, at ease and confident (zero pressure), and excited about the vision for their own home. This is the top of the scorecard, weighted above whether the deal closed that day -- a warm no can outscore a pushy yes."
    },
    "guarantees_note": "Grade whether the rep said the guarantees that actually fit this call: the 48-hour fast-fix window, all-inclusive pricing ('the quote is the bill'), the lease-vs-own disclosure on holiday, the 3-year labor warranty on permanent, the referral offer to a happy customer, the rebook lock at takedown, and the permanent-lighting seed only when the fit was really there (past holiday customer, takedown call, a ladder-averse homeowner). Never grade an element that does not apply to this call.",
    "hard_metrics": {
      "rep_talk_ratio_target": 0.43
    },
    "weighting": {
      "experience": 0.40,
      "sales": 0.35,
      "hospitality": 0.25
    }
  }
  $rubric$::jsonb,
  'seeded'
);
