// Cancels only an undialed setup attempt after the browser phone client fails.
// An active or ended customer call must use the normal end/outcome flow.

import { NextResponse } from 'next/server';
import { resolveCurrentHubActor } from '@/lib/auth/resource';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AbandonResult = {
  result_code: string;
  session_id: string | null;
  call_id: string | null;
  status: string | null;
  already_abandoned: boolean;
};

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, abandoned: false }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!UUID_PATTERN.test(sessionId)) {
    return NextResponse.json({ configured: true, abandoned: false, error: 'sessionId must be a valid id.' }, { status: 400 });
  }
  const actorResolution = await resolveCurrentHubActor();
  if (actorResolution.status !== 'resolved') {
    return NextResponse.json(
      { configured: true, abandoned: false, error: 'Access denied.' },
      { status: actorResolution.status === 'unavailable' ? 503 : 403 },
    );
  }

  const supabase = getSupabaseServerClient()!;
  const { data, error } = await supabase.rpc('abandon_owned_live_attempt', {
    p_actor_employee_id: actorResolution.actor.employeeId,
    p_actor_email: actorResolution.actor.email,
    p_session_id: sessionId,
  });
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, abandoned: false, migrated: false, reason: 'Run migration 0020 first.' });
    }
    console.error('Abandon live attempt failed:', error);
    return NextResponse.json({ configured: true, abandoned: false, error: 'Could not cancel call setup.' }, { status: 500 });
  }
  const result = (Array.isArray(data) ? data[0] : data) as AbandonResult | null;
  if (!result) {
    return NextResponse.json({ configured: true, abandoned: false, error: 'Could not cancel call setup.' }, { status: 500 });
  }
  if (result.result_code === 'session_missing') {
    return NextResponse.json({ configured: true, abandoned: false, error: 'Live attempt not found.' }, { status: 404 });
  }
  if (result.result_code === 'invalid_input') {
    return NextResponse.json({ configured: true, abandoned: false, error: 'Invalid request.' }, { status: 400 });
  }
  if (['actor_inactive', 'not_owned', 'claim_lost'].includes(result.result_code)) {
    return NextResponse.json({ configured: true, abandoned: false, error: 'Access denied.' }, { status: 403 });
  }
  if (!['abandoned', 'already_abandoned'].includes(result.result_code)) {
    return NextResponse.json(
      { configured: true, abandoned: false, error: 'This call already started and must be ended normally.' },
      { status: 409 },
    );
  }
  return NextResponse.json({ configured: true, abandoned: true, alreadyAbandoned: result.already_abandoned });
}
