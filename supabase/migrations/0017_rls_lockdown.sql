-- Ledger #221: RLS lockdown. Supabase security advisor flagged 26 public
-- tables with RLS fully disabled (anon + authenticated roles have full
-- read/write on every row) — includes transcripts (1,210 rows), learnings
-- (1,199 rows), call_scores, call_recordings, second_mile_touches/scans.
--
-- Verified before writing this migration (2026-08-07): every real data path
-- in the app goes through getSupabaseServerClient() (service role), which
-- bypasses RLS unconditionally. The two anon-key clients
-- (getSupabaseBrowserClient / getSupabaseAuthServerClient) are used ONLY for
-- supabase.auth.getUser()/signOut() — zero .from() calls found on either.
-- No permissive policy is added: locking these tables to service-role-only
-- access matches how the app already behaves; this migration just makes
-- that the enforced floor instead of a convention nobody checks.

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playbook_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coaching_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recording_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rubric_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_reply_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.second_mile_touches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.second_mile_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_sessions ENABLE ROW LEVEL SECURITY;
