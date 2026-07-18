// GET /api/coach/calls/[id] -- one scored call in full plus its transcript,
// for the call-review browser's detail pane. Same role gate as the list
// route (copied from GET /api/digest): a rep gets the friendly 403 before
// any query runs. 404 when the call_scores row doesn't exist, same
// convention as GET /api/leads/[id] and GET /api/digest/[id].
//
// has_recording tells the client whether GET /api/coach/calls/[id]/audio
// will actually return audio, so it can show/hide the <audio> player
// without a failed request -- one extra cheap query on call_recordings.
// Best-effort: a lookup failure just leaves has_recording false rather
// than failing the whole detail load (the transcript/scorecard are the
// primary content; the player is an enhancement).

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import { resolveStaffRole } from '@/lib/auth/role';
import type { CallScoreRow } from '@/lib/scoring/types';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient()!;
  const role = await resolveStaffRole(supabase, await getSessionEmail());
  if (role === 'rep') {
    return NextResponse.json(
      { configured: true, error: "Call review is for the coach's one-on-one prep, not a rep-facing page." },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('call_scores')
    .select(
      'id, transcript_id, rubric_version, rep_email, vertical_slug, called_at, emotional, sales, hospitality, hard_metrics, experience, experience_score, guarantees, overall, win, fix, scored_at',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0008 first.' });
    }
    console.error('Load call score for call review failed:', error);
    return NextResponse.json({ configured: true, error: 'Could not load this call.' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ configured: true, error: 'Call not found.' }, { status: 404 });
  }

  const call = data as CallScoreRow;

  const { data: transcriptRow, error: transcriptError } = await supabase
    .from('transcripts')
    .select('raw_text, customer_name, outcome, duration_seconds, called_at')
    .eq('id', call.transcript_id)
    .maybeSingle();
  if (transcriptError) {
    console.error('Load transcript for call review failed:', transcriptError);
    return NextResponse.json({ configured: true, error: 'Could not load this call.' }, { status: 500 });
  }

  let hasRecording = false;
  const { data: recordingRow, error: recordingError } = await supabase
    .from('call_recordings')
    .select('ghl_message_id')
    .eq('transcript_id', call.transcript_id)
    .eq('status', 'transcribed')
    .maybeSingle();
  if (recordingError) {
    console.error('Load call recording flag for call review failed:', recordingError);
  } else {
    hasRecording = !!(recordingRow as { ghl_message_id: string | null } | null)?.ghl_message_id;
  }

  return NextResponse.json({ configured: true, call, transcript: transcriptRow ?? null, has_recording: hasRecording });
}
