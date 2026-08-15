// GET /api/live/events?sessionId=&afterMs= -- the console polls this every
// 2s (no websockets, per the brief) for new coaching cards. Also returns the
// session's current running transcript so the same poll drives the live
// transcript pane. Customer-call transcript text is written only by the
// authenticated Twilio bridge through POST /api/live/segment.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { authorizeCallResource, resolveCurrentHubActor } from '@/lib/auth/resource';
import type { CoachingEventRow, LiveSessionRow } from '@/lib/live/types';

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId')?.trim();
  if (!sessionId) {
    return NextResponse.json({ configured: true, error: 'sessionId is required.' }, { status: 400 });
  }
  const afterMs = Number(url.searchParams.get('afterMs') ?? '0');

  const supabase = getSupabaseServerClient()!;
  const actorResolution = await resolveCurrentHubActor();
  if (actorResolution.status !== 'resolved') {
    return NextResponse.json(
      { configured: true, error: 'Access denied.' },
      { status: actorResolution.status === 'unavailable' ? 503 : 403 },
    );
  }

  const { data: sessionData, error: sessionError } = await supabase
    .from('live_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionError) {
    if (isMissingTableError(sessionError)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0005 first.' });
    }
    console.error('Load live session for events poll failed:', sessionError);
    return NextResponse.json({ configured: true, error: 'Could not load the live session.' }, { status: 500 });
  }
  if (!sessionData) {
    return NextResponse.json({ configured: true, error: 'Live session not found.' }, { status: 404 });
  }
  const session = sessionData as LiveSessionRow;
  if (!session.call_id) {
    return NextResponse.json({ configured: true, error: 'Live session is not linked to a call.' }, { status: 409 });
  }

  const authorization = await authorizeCallResource(supabase, {
    actor: actorResolution.actor,
    callId: session.call_id,
    action: 'live_events.read',
    resourceType: 'live_session',
    resourceId: sessionId,
    teamCapability: 'operations.admin',
  });
  if (authorization.status !== 'authorized') {
    const status = authorization.status === 'unavailable' ? 503
      : authorization.status === 'missing' ? 404 : 403;
    return NextResponse.json({ configured: true, error: 'Access denied.' }, { status });
  }

  const { data: eventsData, error: eventsError } = await supabase
    .from('coaching_events')
    .select('*')
    .eq('call_id', session.call_id)
    .gt('at_ms', Number.isFinite(afterMs) ? afterMs : 0)
    .order('at_ms', { ascending: true });
  if (eventsError) {
    console.error('Load coaching events failed:', eventsError);
    return NextResponse.json({ configured: true, error: 'Could not load coaching events.' }, { status: 500 });
  }
  const events = (eventsData ?? []) as CoachingEventRow[];

  return NextResponse.json({
    configured: true,
    status: session.status,
    transcriptRunning: session.transcript_running,
    events: events.map(e => ({
      id: e.id,
      atMs: e.at_ms,
      trigger: e.trigger,
      card: e.card_text,
      expanded: e.expanded_text,
      shown: e.shown,
      repRating: e.rep_rating,
    })),
  });
}
