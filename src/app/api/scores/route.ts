// GET /api/scores?rep=<email>&days=<n> — call_scores rows for the UI (a
// future rep digest / leaderboard) and sibling workstreams. rep filters on
// rep_email exactly; days filters to scored_at within the last N days
// (default 30). Newest first, capped at RESULT_LIMIT so this never returns
// an unbounded payload.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
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

  let query = supabase
    .from('call_scores')
    .select(
      'id, transcript_id, rubric_version, rep_email, vertical_slug, called_at, emotional, sales, hospitality, hard_metrics, experience, experience_score, guarantees, overall, win, fix, scored_at',
    )
    .gte('scored_at', since)
    .order('scored_at', { ascending: false })
    .limit(RESULT_LIMIT);

  if (rep) query = query.eq('rep_email', rep);

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
