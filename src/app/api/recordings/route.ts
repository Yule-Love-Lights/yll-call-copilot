// GET /api/recordings — visibility into the recordings pipeline (Workstream
// 1): the last sync time, counts by status, and the most recent 50
// recordings (with their outcome, once transcribed) for the /recordings
// page.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';

type CallRecordingRow = {
  id: string;
  ghl_contact_id: string | null;
  direction: string | null;
  called_at: string | null;
  duration_seconds: number | null;
  status: string;
  skip_reason: string | null;
  transcript_id: string | null;
  created_at: string;
};

const STATUS_KEYS = ['pending', 'transcribed', 'skipped', 'failed'] as const;

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const supabase = getSupabaseServerClient()!;

  try {
    const { data: stateData, error: stateError } = await supabase
      .from('recording_sync_state')
      .select('last_synced_at')
      .eq('id', 1)
      .maybeSingle();
    if (stateError) throw stateError;

    const { data: statusRows, error: statusError } = await supabase.from('call_recordings').select('status');
    if (statusError) throw statusError;

    const counts = { pending: 0, transcribed: 0, skipped: 0, failed: 0 };
    for (const row of (statusRows ?? []) as { status: string }[]) {
      if ((STATUS_KEYS as readonly string[]).includes(row.status)) {
        counts[row.status as keyof typeof counts]++;
      }
    }

    const { data: recentData, error: recentError } = await supabase
      .from('call_recordings')
      .select('id, ghl_contact_id, direction, called_at, duration_seconds, status, skip_reason, transcript_id, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (recentError) throw recentError;
    const recentRows = (recentData ?? []) as CallRecordingRow[];

    const transcriptIds = recentRows.map(r => r.transcript_id).filter((id): id is string => !!id);
    let outcomeByTranscriptId = new Map<string, string>();
    if (transcriptIds.length > 0) {
      const { data: transcriptRows } = await supabase.from('transcripts').select('id, outcome').in('id', transcriptIds);
      outcomeByTranscriptId = new Map(
        ((transcriptRows ?? []) as { id: string; outcome: string }[]).map(t => [t.id, t.outcome]),
      );
    }

    const recordings = recentRows.map(row => ({
      id: row.id,
      ghlContactId: row.ghl_contact_id,
      direction: row.direction,
      calledAt: row.called_at,
      durationSeconds: row.duration_seconds,
      status: row.status,
      skipReason: row.skip_reason,
      transcriptId: row.transcript_id,
      outcome: row.transcript_id ? (outcomeByTranscriptId.get(row.transcript_id) ?? null) : null,
      createdAt: row.created_at,
    }));

    return NextResponse.json({
      configured: true,
      migrated: true,
      lastSyncedAt: (stateData as { last_synced_at: string | null } | null)?.last_synced_at ?? null,
      counts,
      recordings,
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0007 first.' });
    }
    console.error('List recordings failed:', err);
    return NextResponse.json({ configured: true, error: 'Could not load recordings.' }, { status: 500 });
  }
}
