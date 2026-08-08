// POST /api/live/segment {sessionId, speaker, text, silenceMs?} -- one
// finalized utterance from a live call (simulator or Twilio/Deepgram
// bridge). Appends it to the session's running transcript, runs the pure
// trigger detector (src/lib/live/engine.ts), and on a fired trigger
// generates one coaching card (src/lib/live/card.ts, Claude) and stores it.
// GET /api/live/events then polls for it -- see that route.
//
// Auth: this is the one live/* route the standalone bridge
// (scripts/live-bridge.mjs) calls directly with no browser session, so it is
// classified as route-authenticated in the central policy and authenticates
// itself here: either a constant-time x-live-bridge-secret match, or a fully
// resolved Office actor with office.calls.work. Browser actors are also
// checked against the call that owns the requested live session.

import { NextResponse } from 'next/server';
import {
  getSupabaseAuthServerClient,
  getSupabaseServerClient,
  isMissingTableError,
  isSupabaseConfigured,
} from '@/lib/supabase';
import { resolveHubActor } from '@/lib/auth/actor';
import { hasCapability, type HubActor } from '@/lib/auth/capabilities';
import { verifyHeaderSecret } from '@/lib/auth/machine';
import { auditTeamResourceAccess, decideOwnedResourceAccess } from '@/lib/auth/resource';
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

type SegmentPrincipal =
  | { status: 'authorized'; kind: 'bridge' }
  | { status: 'authorized'; kind: 'employee'; actor: HubActor }
  | { status: 'denied' }
  | { status: 'unavailable' };

async function resolveSegmentPrincipal(request: Request): Promise<SegmentPrincipal> {
  const provided = request.headers.get('x-live-bridge-secret');
  if (provided) {
    const bridgeDecision = verifyHeaderSecret(
      request,
      'x-live-bridge-secret',
      process.env.LIVE_BRIDGE_SECRET,
    );
    if (bridgeDecision === 'authorized') return { status: 'authorized', kind: 'bridge' };
    return { status: bridgeDecision === 'unconfigured' ? 'unavailable' : 'denied' };
  }

  const authClient = await getSupabaseAuthServerClient();
  if (!authClient) return { status: 'unavailable' };
  const { data, error } = await authClient.auth.getUser();
  if (error) return { status: 'unavailable' };
  if (!data.user) return { status: 'denied' };

  const actorResolution = await resolveHubActor(data.user);
  if (actorResolution.status !== 'resolved') return actorResolution;
  if (!hasCapability(actorResolution.actor, 'office.calls.work')) {
    return { status: 'denied' };
  }
  return { status: 'authorized', kind: 'employee', actor: actorResolution.actor };
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }

  const principal = await resolveSegmentPrincipal(request);
  if (principal.status !== 'authorized') {
    if (principal.status === 'unavailable') {
      return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
    }
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

  // A bridge secret alone cannot create transcript data for an arbitrary or
  // simulator session. The signed WebSocket grant must already have been
  // durably and atomically consumed for this Twilio session.
  if (
    principal.kind === 'bridge' &&
    (session.mode !== 'twilio' || !session.media_stream_started_at)
  ) {
    return NextResponse.json(
      { configured: true, saved: false, error: 'Stream authorization required.' },
      { status: 403 },
    );
  }

  if (principal.kind === 'employee') {
    const { data: ownerData, error: ownerError } = await supabase
      .from('calls')
      .select('rep_email')
      .eq('id', session.call_id)
      .maybeSingle();
    if (ownerError) {
      console.error('Load live session owner failed:', ownerError);
      return NextResponse.json(
        { configured: true, saved: false, error: 'Could not authorize this live session.' },
        { status: 500 },
      );
    }
    const ownerEmail = (ownerData as { rep_email?: unknown } | null)?.rep_email;
    const access = decideOwnedResourceAccess(
      principal.actor,
      ownerEmail,
      'operations.admin',
    );
    if (access === 'denied') {
      return NextResponse.json(
        { configured: true, saved: false, error: 'Access denied.' },
        { status: 403 },
      );
    }
    if (
      access === 'team' &&
      !(await auditTeamResourceAccess(supabase, {
        actor: principal.actor,
        action: 'live_segment.write',
        resourceType: 'live_session',
        resourceId: sessionId,
        ownerEmail: ownerEmail as string,
      }))
    ) {
      return NextResponse.json(
        { configured: true, saved: false, error: 'Could not audit this access.' },
        { status: 503 },
      );
    }
  }

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
