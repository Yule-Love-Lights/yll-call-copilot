// POST /api/practice/[id]/end -- the rep hit "End and score". Flattens the
// turns into the same "Rep: / Customer:" transcript shape every real call's
// raw_text uses, scores it with the exact same engine (scoreCall) against
// the active rubric/playbook/offer, and stores the result on this session
// row only -- never call_scores, never the scoreboard/digest/brain. Marks
// the session ended either way: a scoring failure (Claude down, bad rubric)
// still ends the call and keeps the transcript, with a friendly "could not
// score" instead of losing the rep's practice run.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import { isClaudeConfigured } from '@/lib/claude';
import { flattenPracticeTranscript } from '@/lib/practice/transcript';
import { loadVerticalContext } from '@/lib/practice/context';
import { getActiveRubric } from '@/lib/scoring/rubric';
import { getOfferElements } from '@/lib/scoring/batch';
import { scoreCall } from '@/lib/scoring/score';
import type { PracticeSessionRow } from '@/lib/practice/types';

function isOwnSession(repEmail: string | null, session: PracticeSessionRow): boolean {
  return !!repEmail && !!session.rep_email && repEmail.toLowerCase() === session.rep_email.toLowerCase();
}

const EMPTY_HARD_METRICS = {
  rep_talk_ratio: 0,
  question_count: 0,
  dead_air_seconds: 0,
  interruption_count: 0,
  duration_seconds: 0,
};

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' });
  }
  const { id } = await params;

  const supabase = getSupabaseServerClient()!;
  const repEmail = await getSessionEmail();

  const { data: sessionData, error: sessionError } = await supabase
    .from('practice_sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (sessionError) {
    if (isMissingTableError(sessionError)) {
      return NextResponse.json({ configured: true, saved: false, migrated: false, reason: 'Run migration 0016 first.' });
    }
    console.error('Load practice session for end failed:', sessionError);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not load the practice session.' }, { status: 500 });
  }
  if (!sessionData) {
    return NextResponse.json({ configured: true, saved: false, error: 'Practice session not found.' }, { status: 404 });
  }
  const session = sessionData as PracticeSessionRow;

  if (!isOwnSession(repEmail, session)) {
    return NextResponse.json({ configured: true, saved: false, error: 'Practice session not found.' }, { status: 404 });
  }

  if (session.status === 'ended') {
    return NextResponse.json({ configured: true, saved: true, alreadyEnded: true, scored: session.score !== null, score: session.score });
  }

  const transcript = flattenPracticeTranscript(session.turns);

  if (!isClaudeConfigured()) {
    const { error: endError } = await supabase
      .from('practice_sessions')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', id);
    if (endError) console.error('Mark practice session ended failed:', endError);
    return NextResponse.json({
      configured: true,
      saved: true,
      scored: false,
      reason: 'Claude not configured -- could not score this practice call.',
    });
  }

  const rubricResult = await getActiveRubric(supabase);
  const offerElements = await getOfferElements(supabase);
  const { playbook, verticalName } = await loadVerticalContext(supabase, session.vertical_slug ?? '');

  let scoreContent = null;
  let scoreFailureReason: string | null = null;

  if (!rubricResult.ok) {
    scoreFailureReason = 'Could not load the scoring rubric.';
  } else {
    try {
      scoreContent = await scoreCall({
        verticalName,
        rubric: rubricResult.content,
        playbook,
        offerElements,
        rawText: transcript,
        hardMetrics: EMPTY_HARD_METRICS,
        utterancesAvailable: false,
      });
    } catch (err) {
      console.error('Practice call scoring failed:', err);
      scoreFailureReason = 'Could not score this practice call.';
    }
  }

  const { error: updateError } = await supabase
    .from('practice_sessions')
    .update({ status: 'ended', ended_at: new Date().toISOString(), score: scoreContent })
    .eq('id', id);
  if (updateError) {
    console.error('Save practice score failed:', updateError);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not save the practice result.' }, { status: 500 });
  }

  if (!scoreContent) {
    return NextResponse.json({ configured: true, saved: true, scored: false, reason: scoreFailureReason ?? 'Could not score this practice call.' });
  }

  return NextResponse.json({ configured: true, saved: true, scored: true, score: scoreContent });
}
