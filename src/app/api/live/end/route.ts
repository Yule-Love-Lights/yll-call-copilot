// POST /api/live/end {sessionId} -- the rep hit "End Call". Marks the
// session ended, stores the accumulated transcript_running as a real
// transcripts row (vertical resolved from the lead, same as POST
// /api/calls), links it onto the calls row opened at /api/live/start, and
// fires the existing extraction pipeline (src/lib/transcripts/process.ts) --
// reused rather than re-implemented, per the brief. The client then routes
// back to the normal /call/[leadId] console (passing this call's id along)
// for outcome tagging and follow-up drafts.
//
// Returns callId so the console's outcome save (POST /api/calls) can UPDATE
// this same row instead of inserting a second one for the same
// conversation -- see that route's file-header comment.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { isClaudeConfigured } from '@/lib/claude';
import { processTranscriptBatch } from '@/lib/transcripts/process';
import type { LiveSessionRow } from '@/lib/live/types';
import type { CallRow, LeadRow } from '@/lib/leads/types';
import type { VerticalRow } from '@/lib/playbook/types';

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId) {
    return NextResponse.json({ configured: true, saved: false, error: 'sessionId is required.' }, { status: 400 });
  }

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
    console.error('Load live session for end failed:', sessionError);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not load the live session.' }, { status: 500 });
  }
  if (!sessionData) {
    return NextResponse.json({ configured: true, saved: false, error: 'Live session not found.' }, { status: 404 });
  }
  const session = sessionData as LiveSessionRow;

  if (session.status === 'ended') {
    return NextResponse.json({ configured: true, saved: true, alreadyEnded: true, callId: session.call_id });
  }

  const { error: endError } = await supabase
    .from('live_sessions')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (endError) {
    console.error('Mark live session ended failed:', endError);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not end the live session.' }, { status: 500 });
  }

  // Always mark the call itself ended, even if the rep hung up before any
  // segment came through (so it does not read as a call still in progress).
  const { error: callEndError } = await supabase
    .from('calls')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', session.call_id);
  if (callEndError) console.error('Mark call ended failed:', callEndError);

  // Re-read transcript_running now, AFTER marking the session ended, rather
  // than trusting the single copy read at the top of this request. A
  // /api/live/segment call already in flight when the rep clicked "End
  // call" writes its line to this same column a few seconds later (its own
  // Claude call for the coaching card runs first) — re-reading here closes
  // most of that window cheaply. A segment landing in the sliver between
  // THIS read and the transcripts insert just below is still possible in
  // principle, but is now a matter of a couple hundred milliseconds rather
  // than however long that segment's Claude call took.
  const { data: refreshedSessionData, error: refreshError } = await supabase
    .from('live_sessions')
    .select('transcript_running')
    .eq('id', sessionId)
    .maybeSingle();
  if (refreshError) console.error('Re-read live session transcript failed:', refreshError);
  const finalTranscript = (refreshedSessionData as Pick<LiveSessionRow, 'transcript_running'> | null)?.transcript_running ?? session.transcript_running;

  let transcriptId: string | null = null;
  const extraction: { attempted: boolean; done: number; failed: number } = { attempted: false, done: 0, failed: 0 };

  if (finalTranscript.trim()) {
    const { data: callData } = await supabase.from('calls').select('lead_id').eq('id', session.call_id).maybeSingle();
    const leadId = (callData as Pick<CallRow, 'lead_id'> | null)?.lead_id ?? null;

    let lead: LeadRow | null = null;
    if (leadId) {
      const { data: leadData } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
      lead = (leadData as LeadRow | null) ?? null;
    }

    let verticalId: string | null = null;
    let verticalName = '';
    if (lead?.vertical_slug) {
      const { data: verticalData } = await supabase
        .from('verticals')
        .select('id, name')
        .eq('slug', lead.vertical_slug)
        .maybeSingle();
      const vertical = verticalData as Pick<VerticalRow, 'id' | 'name'> | null;
      if (vertical) {
        verticalId = vertical.id;
        verticalName = vertical.name;
      }
    }

    const { data: transcriptData, error: transcriptError } = await supabase
      .from('transcripts')
      .insert({
        vertical_id: verticalId,
        customer_name: lead?.full_name ?? null,
        customer_phone: lead?.phone ?? null,
        called_at: session.started_at,
        raw_text: finalTranscript,
      })
      .select('id')
      .single();
    if (transcriptError) {
      console.error('Insert transcript for live call failed:', transcriptError);
      return NextResponse.json({ configured: true, saved: false, error: 'Could not store the transcript.' }, { status: 500 });
    }
    transcriptId = (transcriptData as { id: string }).id;

    const { error: linkError } = await supabase.from('calls').update({ transcript_id: transcriptId }).eq('id', session.call_id);
    if (linkError) console.error('Link transcript to call failed:', linkError);

    if (isClaudeConfigured() && verticalId) {
      extraction.attempted = true;
      const result = await processTranscriptBatch({
        supabase,
        transcriptIds: [transcriptId],
        verticalId,
        verticalName,
        matchOutcomes: false,
      });
      extraction.done = result.done;
      extraction.failed = result.failed;
    }
  }

  return NextResponse.json({
    configured: true,
    saved: true,
    callId: session.call_id,
    transcript: transcriptId ? { created: true, transcriptId, extraction } : { created: false },
  });
}
