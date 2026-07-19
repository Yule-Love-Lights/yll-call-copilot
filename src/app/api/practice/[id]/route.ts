// GET /api/practice/[id] -- owner-of-session only. Practice is rep-private
// (never on the team board), so a session belonging to a different rep (or
// no resolvable rep at all) answers 404, same as it doesn't exist, rather
// than confirming another rep's session id is real.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import type { PracticeSessionRow } from '@/lib/practice/types';

function isOwnSession(repEmail: string | null, session: PracticeSessionRow): boolean {
  return !!repEmail && !!session.rep_email && repEmail.toLowerCase() === session.rep_email.toLowerCase();
}

function toJson(session: PracticeSessionRow) {
  return {
    id: session.id,
    verticalSlug: session.vertical_slug,
    emotionalState: session.emotional_state,
    objective: session.objective,
    turns: session.turns,
    status: session.status,
    score: session.score,
    createdAt: session.created_at,
    endedAt: session.ended_at,
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, session: null });
  }
  const { id } = await params;

  const supabase = getSupabaseServerClient()!;
  const repEmail = await getSessionEmail();

  const { data, error } = await supabase.from('practice_sessions').select('*').eq('id', id).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0016 first.', session: null });
    }
    console.error('Load practice session failed:', error);
    return NextResponse.json({ configured: true, error: 'Could not load the practice session.', session: null }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ configured: true, session: null, error: 'Practice session not found.' }, { status: 404 });
  }
  const session = data as PracticeSessionRow;

  if (!isOwnSession(repEmail, session)) {
    return NextResponse.json({ configured: true, session: null, error: 'Practice session not found.' }, { status: 404 });
  }

  return NextResponse.json({ configured: true, session: toJson(session) });
}
