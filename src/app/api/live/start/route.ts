// Starts or recovers the signed-in employee's one open Twilio attempt for an
// assigned lead. Training uses /practice; this route never creates simulator
// sessions. The RPC owns the call+session transaction and rotates an unused
// dial grant exactly when a previous response was lost.

import { NextResponse } from 'next/server';
import { resolveCurrentHubActor } from '@/lib/auth/resource';
import { createIdempotentDialGrant, isTwilioConfigured } from '@/lib/live/twilioVoice';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StartResult = {
  result_code: 'starting' | 'active' | 'pending_outcome' | 'invalid_input' | 'actor_inactive' | 'lead_missing' | 'not_claimed_by_actor' | 'start_conflict';
  call_id: string | null;
  session_id: string | null;
};

export async function POST(request: Request) {
  if (!isTwilioConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Customer calling is not available.' }, { status: 503 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' });
  }
  const body = await request.json().catch(() => null);
  const leadId = typeof body?.leadId === 'string' ? body.leadId.trim() : '';
  const startRequestId = typeof body?.startRequestId === 'string' ? body.startRequestId.trim() : '';
  if (!UUID_PATTERN.test(leadId) || !UUID_PATTERN.test(startRequestId)) {
    return NextResponse.json(
      { configured: true, saved: false, error: 'leadId and startRequestId must be valid ids.' },
      { status: 400 },
    );
  }

  const actorResolution = await resolveCurrentHubActor();
  if (actorResolution.status !== 'resolved') {
    return NextResponse.json(
      { configured: true, saved: false, error: 'Access denied.' },
      { status: actorResolution.status === 'unavailable' ? 503 : 403 },
    );
  }

  const dial = createIdempotentDialGrant(actorResolution.actor.authUserId, startRequestId);
  const supabase = getSupabaseServerClient()!;
  const { data, error } = await supabase.rpc('start_claimed_live_attempt', {
    p_actor_employee_id: actorResolution.actor.employeeId,
    p_actor_auth_user_id: actorResolution.actor.authUserId,
    p_actor_email: actorResolution.actor.email,
    p_lead_id: leadId,
    p_start_request_id: startRequestId,
    p_dial_grant_hash: dial.hash,
  });
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, saved: false, migrated: false, reason: 'Run migration 0020 first.' });
    }
    console.error('Start live attempt failed:', error);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not start the call.' }, { status: 500 });
  }

  const result = (Array.isArray(data) ? data[0] : data) as StartResult | null;
  if (!result || result.result_code === 'invalid_input') {
    return NextResponse.json({ configured: true, saved: false, error: 'Could not start the call.' }, { status: 400 });
  }
  if (result.result_code === 'lead_missing') {
    return NextResponse.json({ configured: true, saved: false, error: 'Lead not found.' }, { status: 404 });
  }
  if (result.result_code === 'actor_inactive' || result.result_code === 'not_claimed_by_actor') {
    return NextResponse.json({ configured: true, saved: false, error: 'This lead is not assigned to you.' }, { status: 403 });
  }
  if (result.result_code === 'start_conflict') {
    return NextResponse.json(
      { configured: true, saved: false, error: 'Another call setup is already open for this lead.' },
      { status: 409 },
    );
  }
  if (!result.call_id || !result.session_id) {
    return NextResponse.json({ configured: true, saved: false, error: 'Could not start the call.' }, { status: 500 });
  }

  return NextResponse.json({
    configured: true,
    saved: true,
    status: result.result_code,
    sessionId: result.session_id,
    callId: result.call_id,
    dialGrant: result.result_code === 'starting' ? dial.grant : null,
  });
}
