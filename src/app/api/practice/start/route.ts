// POST /api/practice/start { vertical_slug, emotional_state, objective? } --
// the rep picked a scenario on /practice and clicked "Start practice". Builds
// the AI customer's system prompt for this scenario, gets its opening line
// (one Claude call), and creates the practice_sessions row with that line as
// turn one. Returns { id, opening } so the client can route straight into
// the practice room.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import { isClaudeConfigured } from '@/lib/claude';
import { customerOpening, type EmotionalState } from '@/lib/practice/customer';
import { buildSessionSystemPrompt } from '@/lib/practice/context';
import type { PracticeTurn } from '@/lib/practice/types';

const EMOTIONAL_STATES: EmotionalState[] = ['excited', 'busy', 'guarded', 'status'];

type StartValidation =
  | { valid: true; verticalSlug: string; emotionalState: EmotionalState; objective: string | null }
  | { valid: false; error: string };

function validateStartBody(body: unknown): StartValidation {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, error: 'Invalid request body.' };
  }
  const b = body as Record<string, unknown>;

  const verticalSlug = typeof b.vertical_slug === 'string' ? b.vertical_slug.trim() : '';
  if (!verticalSlug) return { valid: false, error: 'vertical_slug is required.' };

  const emotionalState = typeof b.emotional_state === 'string' ? b.emotional_state : '';
  if (!(EMOTIONAL_STATES as string[]).includes(emotionalState)) {
    return { valid: false, error: `emotional_state must be one of: ${EMOTIONAL_STATES.join(', ')}.` };
  }

  const objective = typeof b.objective === 'string' && b.objective.trim() ? b.objective.trim() : null;

  return { valid: true, verticalSlug, emotionalState: emotionalState as EmotionalState, objective };
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' });
  }
  if (!isClaudeConfigured()) {
    return NextResponse.json({ configured: true, saved: false, reason: 'Claude not configured. Set ANTHROPIC_API_KEY in .env.local.' });
  }

  const body = await request.json().catch(() => null);
  const validation = validateStartBody(body);
  if (!validation.valid) {
    return NextResponse.json({ configured: true, saved: false, error: validation.error }, { status: 400 });
  }
  const { verticalSlug, emotionalState, objective } = validation;

  const supabase = getSupabaseServerClient()!;
  const repEmail = await getSessionEmail();

  // Belt-and-suspenders: proxy.ts already gates every non-public route to a
  // signed-in allowlisted staff user, but a narrow cookie-refresh race could
  // still hand back a null email here. Reject before the Claude call and
  // the insert, rather than creating an orphan practice_sessions row (no
  // rep to ever see or delete it) and wasting a Claude call for nothing.
  if (!repEmail) {
    return NextResponse.json({ configured: true, saved: false, error: 'Not signed in.' }, { status: 401 });
  }

  const systemPrompt = await buildSessionSystemPrompt(supabase, { verticalSlug, emotionalState, objective });

  let opening: string;
  try {
    opening = await customerOpening(systemPrompt);
  } catch (err) {
    console.error('Practice opening line generation failed:', err);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not start the practice call.' }, { status: 500 });
  }

  const firstTurn: PracticeTurn = { speaker: 'customer', text: opening, at: new Date().toISOString() };

  const { data, error } = await supabase
    .from('practice_sessions')
    .insert({
      rep_email: repEmail,
      vertical_slug: verticalSlug,
      emotional_state: emotionalState,
      objective,
      turns: [firstTurn],
    })
    .select('id')
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, saved: false, migrated: false, reason: 'Run migration 0016 first.' });
    }
    console.error('Insert practice session failed:', error);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not start the practice session.' }, { status: 500 });
  }

  const id = (data as { id: string }).id;
  return NextResponse.json({ configured: true, saved: true, id, opening });
}
