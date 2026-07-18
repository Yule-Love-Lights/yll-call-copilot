// GET /api/coach/calls/[id]/audio -- streams the GHL call recording (mp3
// bytes) for the owner's call-review browser (/coach/calls), so the coach
// can hear tone and pacing next to the transcript and scorecard, not just
// read text. Same role gate as the sibling routes (copied exactly): a rep
// gets a 403 before any call_scores/call_recordings query runs, since a
// recording is customer PII same as the transcript it comes from.
//
// Historical RingCentral transcripts (or a not-yet-transcribed GHL
// recording) have no usable call_recordings row -- that 404s with a small
// JSON body rather than serving a broken <audio> tag. A GHL download
// failure (network, auth, a deleted recording) degrades to a 502 JSON
// instead of crashing the route, same "GHL is a third party, treat every
// call as fallible" posture downloadRecordingAudio's other caller
// (recordings/pipeline.ts) already takes.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import { resolveStaffRole } from '@/lib/auth/role';
import { downloadRecordingAudio } from '@/lib/ghl/recordings';

const NO_RECORDING_BODY = { configured: true, error: 'No recording available for this call.' } as const;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, error: 'Not configured.' }, { status: 404 });
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

  const { data: scoreRow, error: scoreError } = await supabase
    .from('call_scores')
    .select('id, transcript_id')
    .eq('id', id)
    .maybeSingle();
  if (scoreError) {
    if (isMissingTableError(scoreError)) {
      return NextResponse.json({ configured: true, error: 'Run migration 0008 first.' }, { status: 404 });
    }
    console.error('Load call score for audio playback failed:', scoreError);
    return NextResponse.json({ configured: true, error: 'Could not load this call.' }, { status: 500 });
  }
  if (!scoreRow) {
    return NextResponse.json({ configured: true, error: 'Call not found.' }, { status: 404 });
  }

  const { data: recordingRow, error: recordingError } = await supabase
    .from('call_recordings')
    .select('ghl_message_id')
    .eq('transcript_id', (scoreRow as { transcript_id: string }).transcript_id)
    .eq('status', 'transcribed')
    .maybeSingle();
  if (recordingError) {
    if (isMissingTableError(recordingError)) {
      return NextResponse.json(NO_RECORDING_BODY, { status: 404 });
    }
    console.error('Load call recording for audio playback failed:', recordingError);
    return NextResponse.json({ configured: true, error: 'Could not load this call.' }, { status: 500 });
  }

  const messageId = (recordingRow as { ghl_message_id: string | null } | null)?.ghl_message_id;
  if (!messageId) {
    return NextResponse.json(NO_RECORDING_BODY, { status: 404 });
  }

  try {
    const audio = await downloadRecordingAudio(messageId);
    // NextResponse's BodyInit typing wants a Uint8Array<ArrayBuffer>, not
    // Node's Buffer<ArrayBufferLike> subtype -- Uint8Array.from copies the
    // bytes into a plain ArrayBuffer-backed view that satisfies it.
    return new NextResponse(Uint8Array.from(audio), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.length),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    console.error(`Download recording audio failed for call ${id}:`, err);
    return NextResponse.json(
      { configured: true, error: 'Could not fetch the recording audio from GoHighLevel.' },
      { status: 502 },
    );
  }
}
