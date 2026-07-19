// GET /api/practice -- the signed-in rep's own recent practice sessions
// (newest first), for a small "practice again" / history list. Never
// team-wide: a rep with no resolvable session email gets zero rows, same
// fail-closed convention as GET /api/scores.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';

const RECENT_LIMIT = 20;

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, sessions: [] });
  }

  const supabase = getSupabaseServerClient()!;
  const repEmail = await getSessionEmail();
  if (!repEmail) {
    return NextResponse.json({ configured: true, sessions: [] });
  }

  const { data, error } = await supabase
    .from('practice_sessions')
    .select('id, vertical_slug, emotional_state, objective, status, score, created_at, ended_at')
    .eq('rep_email', repEmail)
    .order('created_at', { ascending: false })
    .limit(RECENT_LIMIT);

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0016 first.', sessions: [] });
    }
    console.error('List practice sessions failed:', error);
    return NextResponse.json({ configured: true, error: 'Could not load your practice sessions.', sessions: [] }, { status: 500 });
  }

  type Row = {
    id: string;
    vertical_slug: string | null;
    emotional_state: string;
    objective: string | null;
    status: string;
    score: unknown;
    created_at: string;
    ended_at: string | null;
  };

  const sessions = ((data ?? []) as Row[]).map(row => ({
    id: row.id,
    verticalSlug: row.vertical_slug,
    emotionalState: row.emotional_state,
    objective: row.objective,
    status: row.status,
    score: row.score,
    createdAt: row.created_at,
    endedAt: row.ended_at,
  }));

  return NextResponse.json({ configured: true, sessions });
}
