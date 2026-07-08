// POST /api/live/segment {sessionId, speaker, text, silenceMs?} -- one
// finalized utterance from a live call (simulator or Twilio/Deepgram
// bridge). Appends it to the session's running transcript, runs the pure
// trigger detector (src/lib/live/engine.ts), and on a fired trigger
// generates one coaching card (src/lib/live/card.ts, Claude) and stores it.
// GET /api/live/events then polls for it -- see that route.
//
// Auth: this is the one live/* route the standalone bridge
// (scripts/live-bridge.mjs) calls directly with no browser session, so it is
// exempt from the staff-session gate in src/proxy.ts (see PUBLIC_PATHS
// there) and instead authenticates itself here: either the
// x-live-bridge-secret header matches LIVE_BRIDGE_SECRET, or (the common
// case -- the browser driving the simulator) a signed-in staff session,
// checked the same way every other route relies on the proxy to have
// already checked it.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import { generateCoachCard } from '@/lib/live/card';
import { createLiveEngineState, detectTriggers, type LiveEngineState, type Segment, type TriggerType } from '@/lib/live/engine';
import type { LiveSessionRow } from '@/lib/live/types';
import type { CallRow, LeadRow } from '@/lib/leads/types';
import type { Playbook, VerticalRow } from '@/lib/playbook/types';

function validateSegmentBody(
  body: unknown,
): { valid: true; sessionId: string; speaker: 'rep' | 'customer'; text: string; silenceMs: number | undefined } | { valid: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, error: 'Invalid request body.' };
  }
  const b = body as Record<string, unknown>;

  const sessionId = typeof b.sessionId === 'string' ? b.sessionId.trim() : '';
  if (!sessionId) return { valid: false, error: 'sessionId is required.' };

  const speaker = b.speaker === 'rep' || b.speaker === 'customer' ? b.speaker : null;
  if (!speaker) return { valid: false, error: 'speaker must be "rep" or "customer".' };

  const text = typeof b.text === 'string' ? b.text : '';
  const silenceMs = typeof b.silenceMs === 'number' && b.silenceMs >= 0 ? b.silenceMs : undefined;

  return { valid: true, sessionId, speaker, text, silenceMs };
}

async function isAuthorized(request: Request): Promise<boolean> {
  const bridgeSecret = process.env.LIVE_BRIDGE_SECRET;
  const provided = request.headers.get('x-live-bridge-secret');
  if (bridgeSecret && provided === bridgeSecret) return true;

  // Not the bridge -- this path is public in src/proxy.ts only so the
  // bridge (no browser session) can reach it, so fall back to requiring the
  // same signed-in staff session every other route gets for free.
  const email = await getSessionEmail();
  return !!email;
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' });
  }

  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const validation = validateSegmentBody(body);
  if (!validation.valid) {
    return NextResponse.json({ configured: true, saved: false, error: validation.error }, { status: 400 });
  }
  const { sessionId, speaker, text, silenceMs } = validation;

  const supabase = getSupabaseServerClient()!;

  const { data: sessionData, error: sessionError } = await supabase
    .from('live_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionError) {
    if (isMissingTableError(sessionError)) {
      return NextResponse.json({ configured: true, saved: false, migrated: false, reason: 'Run migration 0005 first.' });
    }
    console.error('Load live session for segment failed:', sessionError);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not load the live session.' }, { status: 500 });
  }
  if (!sessionData) {
    return NextResponse.json({ configured: true, saved: false, error: 'Live session not found.' }, { status: 404 });
  }
  const session = sessionData as LiveSessionRow;

  if (session.status !== 'active') {
    return NextResponse.json({ configured: true, saved: false, ended: true });
  }

  const atMs = Math.max(0, Date.now() - new Date(session.started_at).getTime());

  const line = text.trim() ? `${speaker}: ${text.trim()}` : null;
  const transcriptRunning = line ? [session.transcript_running, line].filter(Boolean).join('\n') : session.transcript_running;

  // Rebuild the rate-limit state from what is already persisted for this
  // call -- there is no in-memory state across serverless invocations, and
  // only triggers that actually produced a stored card should count toward
  // future rate limiting (see engine.ts's state contract).
  const { data: priorEvents } = await supabase
    .from('coaching_events')
    .select('trigger, at_ms')
    .eq('call_id', session.call_id);
  const state: LiveEngineState = createLiveEngineState();
  for (const row of (priorEvents ?? []) as { trigger: string; at_ms: number }[]) {
    const type = row.trigger as TriggerType;
    const existing = state.lastFiredAtMs[type];
    if (existing === undefined || row.at_ms > existing) state.lastFiredAtMs[type] = row.at_ms;
  }

  const segment: Segment = { speaker, text, atMs, silenceMs };
  const triggers = detectTriggers(segment, state);

  // At most one card per segment, matching the console's one-card-at-a-time
  // UI -- if more than one trigger type fired, the first (silence, then
  // whichever keyword matched first) wins. The others are simply not acted
  // on this time; since only an ACTED-ON trigger gets persisted, they are
  // free to fire again on a later segment instead of being spuriously
  // rate-limited for a card the rep never saw.
  let cardGenerated: { card: string; expanded: string } | null = null;
  let cardError: string | null = null;

  if (triggers.length > 0) {
    const trigger = triggers[0];

    const { data: callData } = await supabase.from('calls').select('lead_id').eq('id', session.call_id).maybeSingle();
    const leadId = (callData as Pick<CallRow, 'lead_id'> | null)?.lead_id ?? null;

    let playbook: Playbook | null = null;
    if (leadId) {
      const { data: leadData } = await supabase.from('leads').select('vertical_slug').eq('id', leadId).maybeSingle();
      const verticalSlug = (leadData as Pick<LeadRow, 'vertical_slug'> | null)?.vertical_slug ?? null;
      if (verticalSlug) {
        const { data: verticalData } = await supabase
          .from('verticals')
          .select('id, active_version')
          .eq('slug', verticalSlug)
          .maybeSingle();
        const vertical = verticalData as Pick<VerticalRow, 'id' | 'active_version'> | null;
        if (vertical && vertical.active_version > 0) {
          const { data: versionData } = await supabase
            .from('playbook_versions')
            .select('content')
            .eq('vertical_id', vertical.id)
            .eq('version', vertical.active_version)
            .maybeSingle();
          playbook = (versionData as { content: Playbook } | null)?.content ?? null;
        }
      }
    }

    try {
      cardGenerated = await generateCoachCard({ trigger, rollingTranscript: transcriptRunning, playbook });
      const { error: insertError } = await supabase.from('coaching_events').insert({
        call_id: session.call_id,
        at_ms: trigger.atMs,
        trigger: trigger.type,
        card_text: cardGenerated.card,
        expanded_text: cardGenerated.expanded,
      });
      if (insertError) throw insertError;
    } catch (err) {
      // Best-effort, same philosophy as the follow-up drafts in
      // POST /api/calls: a coaching card failing to generate must never
      // fail the segment itself -- the transcript still needs to be saved.
      console.error('Generate coaching card failed:', err);
      cardGenerated = null;
      cardError = err instanceof Error ? err.message : 'Could not generate a coaching card.';
    }
  }

  if (line) {
    const { error: updateError } = await supabase
      .from('live_sessions')
      .update({ transcript_running: transcriptRunning })
      .eq('id', sessionId);
    if (updateError) console.error('Update live session transcript failed:', updateError);
  }

  return NextResponse.json({
    configured: true,
    saved: true,
    atMs,
    triggers: triggers.map(t => t.type),
    card: cardGenerated,
    cardError,
  });
}
