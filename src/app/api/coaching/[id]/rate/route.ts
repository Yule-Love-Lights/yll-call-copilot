// POST /api/coaching/[id]/rate {rating: 'helpful'|'noise'} -- the rep tapped
// one of the two feedback buttons on a coaching card. A light signal for a
// later pass at tuning which triggers are worth showing; not read anywhere
// yet.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { authorizeCallResource, resolveCurrentHubActor } from '@/lib/auth/resource';
import type { RepRating } from '@/lib/live/types';

const REP_RATINGS: RepRating[] = ['helpful', 'noise'];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const rating = typeof body?.rating === 'string' ? body.rating : '';
  if (!(REP_RATINGS as string[]).includes(rating)) {
    return NextResponse.json({ configured: true, saved: false, error: `rating must be one of: ${REP_RATINGS.join(', ')}.` }, { status: 400 });
  }

  const supabase = getSupabaseServerClient()!;

  const actorResolution = await resolveCurrentHubActor();
  if (actorResolution.status !== 'resolved') {
    return NextResponse.json(
      { configured: true, saved: false, error: 'Access denied.' },
      { status: actorResolution.status === 'unavailable' ? 503 : 403 },
    );
  }

  const { data: eventData, error: eventError } = await supabase
    .from('coaching_events')
    .select('id, call_id')
    .eq('id', id)
    .maybeSingle();
  if (eventError) {
    if (isMissingTableError(eventError)) {
      return NextResponse.json({ configured: true, saved: false, migrated: false, reason: 'Run migration 0005 first.' });
    }
    return NextResponse.json({ configured: true, saved: false, error: 'Could not authorize this rating.' }, { status: 500 });
  }
  const event = eventData as { id: string; call_id: string | null } | null;
  if (!event?.call_id) {
    return NextResponse.json({ configured: true, saved: false, error: 'Coaching event not found.' }, { status: 404 });
  }

  const authorization = await authorizeCallResource(supabase, {
    actor: actorResolution.actor,
    callId: event.call_id,
    action: 'coaching_event.rate',
    resourceType: 'coaching_event',
    resourceId: id,
    // A rating is the rep's own feedback; Owner/Admin may inspect team data but
    // must not impersonate the rep's helpful/noise signal.
    teamCapability: null,
  });
  if (authorization.status !== 'authorized') {
    const status = authorization.status === 'unavailable' ? 503
      : authorization.status === 'missing' ? 404 : 403;
    return NextResponse.json(
      { configured: true, saved: false, error: 'Access denied.' },
      { status },
    );
  }

  const { error } = await supabase
    .from('coaching_events')
    .update({ rep_rating: rating })
    .eq('id', id)
    .eq('call_id', event.call_id);
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, saved: false, migrated: false, reason: 'Run migration 0005 first.' });
    }
    console.error('Rate coaching event failed:', error);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not save the rating.' }, { status: 500 });
  }

  return NextResponse.json({ configured: true, saved: true });
}
