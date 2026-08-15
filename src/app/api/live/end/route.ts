// Ends the signed-in employee's live attempt in one database transaction.
// The RPC locks actor, lead, call, and session, snapshots immutable segments,
// creates at most one transcript, preserves the actual end timestamp, and
// leaves the attempt pending its required outcome.

import { NextResponse } from 'next/server';
import { isClaudeConfigured } from '@/lib/claude';
import { resolveCurrentHubActor } from '@/lib/auth/resource';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { processTranscriptBatch } from '@/lib/transcripts/process';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EndResult = {
  result_code: string;
  session_id: string | null;
  call_id: string | null;
  transcript_id: string | null;
  status: string | null;
  already_ended: boolean;
};

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!UUID_PATTERN.test(sessionId)) {
    return NextResponse.json({ configured: true, saved: false, error: 'sessionId must be a valid id.' }, { status: 400 });
  }
  const actorResolution = await resolveCurrentHubActor();
  if (actorResolution.status !== 'resolved') {
    return NextResponse.json(
      { configured: true, saved: false, error: 'Access denied.' },
      { status: actorResolution.status === 'unavailable' ? 503 : 403 },
    );
  }

  const supabase = getSupabaseServerClient()!;
  const { data, error } = await supabase.rpc('end_owned_live_attempt', {
    p_actor_employee_id: actorResolution.actor.employeeId,
    p_actor_email: actorResolution.actor.email,
    p_session_id: sessionId,
  });
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, saved: false, migrated: false, reason: 'Run migration 0020 first.' });
    }
    console.error('End live attempt failed:', error);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not end the call.' }, { status: 500 });
  }
  const result = (Array.isArray(data) ? data[0] : data) as EndResult | null;
  if (!result) {
    return NextResponse.json({ configured: true, saved: false, error: 'Could not end the call.' }, { status: 500 });
  }
  if (result.result_code === 'session_missing') {
    return NextResponse.json({ configured: true, saved: false, error: 'Live attempt not found.' }, { status: 404 });
  }
  if (result.result_code === 'invalid_input') {
    return NextResponse.json({ configured: true, saved: false, error: 'Invalid request.' }, { status: 400 });
  }
  if (['actor_inactive', 'not_owned', 'claim_lost'].includes(result.result_code)) {
    return NextResponse.json({ configured: true, saved: false, error: 'Access denied.' }, { status: 403 });
  }
  if (!['ended', 'already_ended', 'abandoned_before_dial'].includes(result.result_code) || !result.call_id) {
    return NextResponse.json({ configured: true, saved: false, error: 'This call cannot be ended from its current state.' }, { status: 409 });
  }

  const extraction = { attempted: false, done: 0, failed: 0 };
  // Extraction is idempotent. Re-drive it on an already-ended retry so a
  // crash after the transactional end cannot strand the transcript forever.
  if (result.transcript_id && isClaudeConfigured()) {
    const { data: transcriptData } = await supabase
      .from('transcripts')
      .select('vertical_id')
      .eq('id', result.transcript_id)
      .eq('metric_scope', 'performance')
      .maybeSingle();
    const verticalId = (transcriptData as { vertical_id?: string | null } | null)?.vertical_id ?? null;
    if (verticalId) {
      const { data: verticalData } = await supabase.from('verticals').select('name').eq('id', verticalId).maybeSingle();
      extraction.attempted = true;
      const processed = await processTranscriptBatch({
        supabase,
        transcriptIds: [result.transcript_id],
        verticalId,
        verticalName: (verticalData as { name?: string } | null)?.name ?? '',
        matchOutcomes: false,
      });
      extraction.done = processed.done;
      extraction.failed = processed.failed;
    }
  }

  return NextResponse.json({
    configured: true,
    saved: true,
    alreadyEnded: result.already_ended,
    status: result.status,
    sessionId: result.session_id,
    callId: result.call_id,
    transcript: result.transcript_id
      ? { created: !result.already_ended, transcriptId: result.transcript_id, extraction }
      : { created: false },
  });
}
