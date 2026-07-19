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
import type { CallScoreContent } from '@/lib/scoring/types';

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

  // CLAIM-BEFORE-SCORE compare-and-swap: the status flip from 'active' to
  // 'ended' only APPLIES when the row is still 'active' at write time (a
  // real UPDATE...WHERE, same atomicity as the second-mile send route's
  // claim). Two /end calls racing (double click, retry) can both pass the
  // ownership check above, but only one gets a non-empty `claimedRows` back
  // -- that request is the sole owner of this session for the rest of the
  // handler and the only one that may ever call scoreCall. The loser never
  // scores; it just reads back whatever the winner stored.
  const { data: claimedRows, error: claimError } = await supabase
    .from('practice_sessions')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'active')
    .select();
  if (claimError) {
    console.error('Claim practice session for end failed:', claimError);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not end this practice session.' }, { status: 500 });
  }

  if (!claimedRows || claimedRows.length === 0) {
    // Already ended (a prior /end call, whether that was moments ago or is
    // this same race) -- fetch the stored score and hand it back. Never a
    // second scoreCall for the same session.
    const { data: currentData, error: currentError } = await supabase
      .from('practice_sessions')
      .select('score')
      .eq('id', id)
      .maybeSingle();
    if (currentError) {
      console.error('Load already-ended practice session failed:', currentError);
      return NextResponse.json({ configured: true, saved: false, error: 'Could not load the practice result.' }, { status: 500 });
    }
    const score = (currentData as { score: CallScoreContent | null } | null)?.score ?? null;
    return NextResponse.json({ configured: true, saved: true, alreadyEnded: true, scored: score !== null, score });
  }

  const transcript = flattenPracticeTranscript(session.turns);

  if (!isClaudeConfigured()) {
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
    .update({ score: scoreContent })
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
