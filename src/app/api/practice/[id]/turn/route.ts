// POST /api/practice/[id]/turn { text } -- the rep's line (typed or
// voice-transcribed client-side). Appends it as a rep turn, asks the AI
// customer for its next line (rebuilding the system prompt from the
// session's saved scenario so an edited playbook/offer is reflected live),
// appends that as a customer turn, and returns just the reply text for the
// room to speak/show. 409 if the call already ended. Owner-of-session only,
// same as GET /api/practice/[id] -- practice is rep-private, never on the
// team board.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import { isClaudeConfigured } from '@/lib/claude';
import { customerReply, type EmotionalState } from '@/lib/practice/customer';
import { buildSessionSystemPrompt } from '@/lib/practice/context';
import { MAX_REP_TURNS, MAX_TURN_TEXT_LENGTH } from '@/lib/practice/limits';
import type { PracticeSessionRow, PracticeTurn } from '@/lib/practice/types';

function isOwnSession(repEmail: string | null, session: PracticeSessionRow): boolean {
  return !!repEmail && !!session.rep_email && repEmail.toLowerCase() === session.rep_email.toLowerCase();
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' });
  }
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const text = typeof (body as Record<string, unknown> | null)?.text === 'string' ? ((body as Record<string, unknown>).text as string).trim() : '';
  if (!text) {
    return NextResponse.json({ configured: true, saved: false, error: 'text is required.' }, { status: 400 });
  }
  if (text.length > MAX_TURN_TEXT_LENGTH) {
    return NextResponse.json({ configured: true, saved: false, error: 'That turn is too long. Keep it to a couple of sentences.' }, { status: 400 });
  }

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
    console.error('Load practice session for turn failed:', sessionError);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not load the practice session.' }, { status: 500 });
  }
  if (!sessionData) {
    return NextResponse.json({ configured: true, saved: false, error: 'Practice session not found.' }, { status: 404 });
  }
  const session = sessionData as PracticeSessionRow;

  // Not-found, not 403, on a mismatch -- never confirm to a rep that some
  // other rep's session id exists.
  if (!isOwnSession(repEmail, session)) {
    return NextResponse.json({ configured: true, saved: false, error: 'Practice session not found.' }, { status: 404 });
  }

  if (session.status === 'ended') {
    return NextResponse.json({ configured: true, saved: false, error: 'This practice call already ended.' }, { status: 409 });
  }

  const repTurnCount = session.turns.filter(turn => turn.speaker === 'rep').length;
  if (repTurnCount >= MAX_REP_TURNS) {
    return NextResponse.json(
      { configured: true, saved: false, error: 'This practice call reached its length limit. End it and get your score.' },
      { status: 409 },
    );
  }

  if (!isClaudeConfigured()) {
    return NextResponse.json({ configured: true, saved: false, reason: 'Claude not configured. Set ANTHROPIC_API_KEY in .env.local.' });
  }

  const repTurn: PracticeTurn = { speaker: 'rep', text, at: new Date().toISOString() };
  const turnsWithRep = [...session.turns, repTurn];

  const systemPrompt = await buildSessionSystemPrompt(supabase, {
    verticalSlug: session.vertical_slug ?? '',
    emotionalState: session.emotional_state as EmotionalState,
    objective: session.objective,
  });

  let reply: string;
  try {
    reply = await customerReply(turnsWithRep, systemPrompt);
  } catch (err) {
    console.error('Practice customer reply generation failed:', err);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not get the customer\'s next line.' }, { status: 500 });
  }

  const customerTurn: PracticeTurn = { speaker: 'customer', text: reply, at: new Date().toISOString() };
  const turns = [...turnsWithRep, customerTurn];

  // Status-guarded write: only applies while the session is still 'active',
  // so a /turn that was in flight when /end claimed the session can never
  // resurrect a turn onto an already-ended, already-scored call. This closes
  // the turn-vs-end race. The remaining same-rep turn-vs-turn race (two
  // rapid submits both reading the same `session.turns` and each appending
  // their own tail, one clobbering the other's turn) is left as is -- the
  // client already disables the input while a turn is pending, and adding
  // array-level optimistic locking here would be over-engineering for a
  // single-user practice session.
  const { data: updatedRows, error: updateError } = await supabase
    .from('practice_sessions')
    .update({ turns })
    .eq('id', id)
    .eq('status', 'active')
    .select();
  if (updateError) {
    console.error('Save practice turn failed:', updateError);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not save the turn.' }, { status: 500 });
  }
  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json({ configured: true, saved: false, error: 'This practice call has ended.' }, { status: 409 });
  }

  return NextResponse.json({ configured: true, saved: true, reply });
}
