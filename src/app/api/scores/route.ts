// GET /api/scores?rep=<email>&days=<n> — call_scores rows for the UI (a
// future rep digest / leaderboard) and sibling workstreams. rep filters on
// rep_email exactly; days filters to scored_at within the last N days
// (default 30). Newest first, capped at RESULT_LIMIT so this never returns
// an unbounded payload.
//
// Role-gated: a signed-in 'rep' may only ever see their OWN rows -- the
// two-week private-onboarding and one-on-one-corrections rules break the
// moment any rep can point ?rep= at a teammate and read their fix.notes /
// fix.transcript_quote. Only a non-rep role (owner, admin) may honor ?rep=
// or see team-wide rows. See src/lib/auth/role.ts.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import { resolveStaffRole } from '@/lib/auth/role';
import type { CallScoreRow } from '@/lib/scoring/types';

const DEFAULT_DAYS = 30;
const RESULT_LIMIT = 200;

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, scores: [] });
  }

  const url = new URL(request.url);
  const rep = url.searchParams.get('rep');
  const daysParam = url.searchParams.get('days');
  const days = daysParam && Number.isFinite(Number(daysParam)) && Number(daysParam) > 0 ? Number(daysParam) : DEFAULT_DAYS;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const supabase = getSupabaseServerClient()!;

  const sessionEmail = await getSessionEmail();
  const role = await resolveStaffRole(supabase, sessionEmail);

  let query = supabase
    .from('call_scores')
    .select(
      'id, transcript_id, rubric_version, rep_email, vertical_slug, called_at, emotional, sales, hospitality, hard_metrics, experience, experience_score, guarantees, overall, win, fix, scored_at',
    )
    .gte('scored_at', since)
    .order('scored_at', { ascending: false })
    .limit(RESULT_LIMIT);

  if (role === 'rep') {
    // A rep always sees their own full rows (never anyone else's); ?rep=
    // is ignored entirely for a rep caller. No session email at all fails
    // closed to zero rows rather than an unfiltered query.
    if (!sessionEmail) {
      return NextResponse.json({ configured: true, scores: [] });
    }
    query = query.eq('rep_email', sessionEmail);
  } else if (rep) {
    query = query.eq('rep_email', rep);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, scores: [], reason: 'Run migration 0008 first.' });
    }
    console.error('Load call scores failed:', error);
    return NextResponse.json({ configured: true, scores: [], reason: 'Could not load scores.' }, { status: 500 });
  }

  return NextResponse.json({ configured: true, scores: (data ?? []) as CallScoreRow[] });
}
