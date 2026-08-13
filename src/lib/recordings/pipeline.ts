// The recordings orchestration (Workstream 1, see
// docs/SALES-EXCELLENCE-PLAN.md section 4): for each pending call_recordings
// row, download the audio from GHL, transcribe it with Deepgram, apply the
// junk guard, label the outcome, insert a transcripts row, run the EXISTING
// learnings extraction (the same extractLearnings() the upload path uses),
// and mark the recording row done. Shared by both the nightly cron
// (GET /api/cron/sync-recordings) and the on-demand batch button
// (POST /api/recordings/continue) — neither route duplicates this logic.
//
// Best-effort per recording: one failure marks that row 'failed' with a
// detail and the loop moves on, same philosophy as processTranscriptBatch
// (src/lib/transcripts/process.ts).

import type { SupabaseClient } from '@supabase/supabase-js';
import { getContact } from '../ghl/client';
import { downloadRecordingAudio, getGhlUserEmail } from '../ghl/recordings';
import { isDeepgramConfigured, transcribeRecording } from '../deepgram';
import { isClaudeConfigured } from '../claude';
import { extractLearnings } from '../transcripts/extract';
import { junkReasonFromTurns } from '../transcripts/junk';
import { matchRecordingOutcome } from './outcomes';
import { MIN_RECORDING_SECONDS, RECORDING_BATCH_SIZE } from './sync';

export { RECORDING_BATCH_SIZE };

const HOLIDAY_VERTICAL_SLUG = 'holiday';

// A 'processing' row whose processing_at is older than this is treated as
// abandoned (the invocation that claimed it crashed or timed out) and is
// reclaimed by the next run instead of being stuck forever.
const PROCESSING_STALE_MS = 15 * 60 * 1000;

type CallRecordingRow = {
  id: string;
  ghl_message_id: string | null;
  ghl_contact_id: string | null;
  ghl_user_id: string | null;
  direction: string | null;
  called_at: string | null;
  duration_seconds: number | null;
  status: string;
  processing_at: string | null;
};

type HolidayVertical = { id: string; name: string };

async function resolveHolidayVertical(supabase: SupabaseClient): Promise<HolidayVertical | null> {
  const { data } = await supabase.from('verticals').select('id, name').eq('slug', HOLIDAY_VERTICAL_SLUG).maybeSingle();
  return (data as HolidayVertical | null) ?? null;
}

async function markRow(supabase: SupabaseClient, id: string, patch: Record<string, unknown>): Promise<void> {
  await supabase.from('call_recordings').update(patch).eq('id', id);
}

export type ProcessOutcome = 'transcribed' | 'skipped' | 'failed';

// Processes one call_recordings row through to completion (or a recorded
// failure). Exported on its own — not just via processPendingRecordings —
// so a caller that already has the row in hand doesn't need a second DB
// round trip to re-select it.
export async function processOneRecording(
  supabase: SupabaseClient,
  row: CallRecordingRow,
  vertical: HolidayVertical | null,
): Promise<ProcessOutcome> {
  try {
    if (!row.ghl_message_id) {
      await markRow(supabase, row.id, { status: 'failed', detail: { error: 'Missing ghl_message_id.' } });
      return 'failed';
    }
    if (row.duration_seconds != null && row.duration_seconds < MIN_RECORDING_SECONDS) {
      await markRow(supabase, row.id, { status: 'skipped', skip_reason: 'duration_under_20s' });
      return 'skipped';
    }
    if (!isDeepgramConfigured()) {
      await markRow(supabase, row.id, { status: 'failed', detail: { error: 'Deepgram not configured.' } });
      return 'failed';
    }
    if (!isClaudeConfigured()) {
      await markRow(supabase, row.id, { status: 'failed', detail: { error: 'Claude not configured.' } });
      return 'failed';
    }

    // Hydrate the contact once, best-effort: feeds both the customer_phone/
    // customer_name stored on the transcript row and the Quote Tool phone/
    // email outcome match. A hydrate failure degrades to nulls rather than
    // failing the whole recording — the call still gets transcribed.
    let customerPhone: string | null = null;
    let customerEmail: string | null = null;
    let customerName: string | null = null;
    if (row.ghl_contact_id) {
      try {
        const contact = await getContact(row.ghl_contact_id);
        customerPhone = contact.phone ?? null;
        customerEmail = contact.email ?? null;
        customerName = contact.fullName ?? null;
      } catch (err) {
        console.error(`GHL contact hydrate failed for recording ${row.id}:`, err);
      }
    }

    const audio = await downloadRecordingAudio(row.ghl_message_id);
    // GHL call recordings are mp3; Deepgram auto-detects encoding from the
    // audio bytes regardless, so this is a hint, not a hard requirement.
    const transcribed = await transcribeRecording(audio, 'audio/mpeg');

    const junk = junkReasonFromTurns(transcribed.utterances.map(u => ({ speaker: String(u.speaker), text: u.text })));
    if (junk) {
      await markRow(supabase, row.id, { status: 'skipped', skip_reason: junk });
      return 'skipped';
    }

    const repEmail = row.ghl_user_id ? await getGhlUserEmail(row.ghl_user_id) : null;
    const outcomeMatch = await matchRecordingOutcome({
      ghl_contact_id: row.ghl_contact_id,
      customer_phone: customerPhone,
      customer_email: customerEmail,
    });

    const { data: transcriptData, error: insertError } = await supabase
      .from('transcripts')
      .insert({
        vertical_id: vertical?.id ?? null,
        source_file: `ghl:${row.ghl_message_id}`,
        customer_name: customerName,
        customer_phone: customerPhone,
        called_at: row.called_at,
        raw_text: transcribed.rawText,
        outcome: outcomeMatch.outcome,
        outcome_source: outcomeMatch.outcome_source,
        ghl_contact_id: row.ghl_contact_id,
        metric_scope: 'performance',
        rep_email: repEmail,
        direction: row.direction,
        // Math.round both sources: the column is an integer and Deepgram
        // reports fractional seconds (a raw 96.23994 made Postgres reject
        // the whole insert with 22P02 on the first live run).
        duration_seconds: Math.round(transcribed.durationSeconds || row.duration_seconds || 0),
        utterances: transcribed.utterances,
      })
      .select('id')
      .single();
    if (insertError) throw insertError;
    const transcriptId = (transcriptData as { id: string }).id;

    try {
      const learnings = await extractLearnings(transcribed.rawText, vertical?.name ?? 'Holiday');
      const { error: learningsError } = await supabase.from('learnings').upsert(
        {
          transcript_id: transcriptId,
          vertical_id: vertical?.id ?? null,
          objections: learnings.objections,
          customer_language: learnings.customer_language,
          what_worked: learnings.what_worked,
          what_failed: learnings.what_failed,
          price_talk: learnings.price_talk,
          questions: learnings.questions,
          summary: learnings.summary,
        },
        { onConflict: 'transcript_id' },
      );
      if (learningsError) throw learningsError;
    } catch (err) {
      // Best-effort, same philosophy as the rest of this function: a
      // learnings-extraction failure must not undo the transcript already
      // saved. The recording still gets marked transcribed & linked; it
      // just has no learnings this run. The existing /verticals ingest UI
      // can re-run extraction on this transcript later if needed.
      console.error(`Learnings extraction failed for recording ${row.id}:`, err);
    }

    await markRow(supabase, row.id, { status: 'transcribed', transcript_id: transcriptId });
    return 'transcribed';
  } catch (err) {
    console.error(`Failed to process recording ${row.id}:`, err);
    await markRow(supabase, row.id, {
      status: 'failed',
      // JSON.stringify, not String(): a thrown Supabase/PostgREST error is a
      // plain object and String() buries the message as "[object Object]".
      detail: { error: err instanceof Error ? err.message : JSON.stringify(err) },
    }).catch(() => {});
    return 'failed';
  }
}

// Claims one candidate row for THIS invocation via a compare-and-swap
// update: the WHERE clause only matches if the row is still in the exact
// state we read it in (plain 'pending', or a 'processing' row whose
// processing_at is still older than the stale cutoff). If the nightly cron
// and a staff click on /api/recordings/continue race on the same row (or
// two staff clicks land at once — the UI's disabled state is per-tab only),
// only one update matches a row and the other gets zero rows back. Exported
// so the race itself is directly testable without driving the whole batch
// loop.
export async function claimRecording(
  supabase: SupabaseClient,
  row: Pick<CallRecordingRow, 'id' | 'status'>,
  now: Date = new Date(),
): Promise<boolean> {
  const nowIso = now.toISOString();
  const cutoffIso = new Date(now.getTime() - PROCESSING_STALE_MS).toISOString();

  const base = supabase
    .from('call_recordings')
    .update({ status: 'processing', processing_at: nowIso })
    .eq('id', row.id);
  const query =
    row.status === 'processing'
      ? base.eq('status', 'processing').lt('processing_at', cutoffIso)
      : base.eq('status', 'pending');

  const { data, error } = await query.select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

export type ProcessRecordingsResult = { done: number; skipped: number; failed: number };

export async function processPendingRecordings(
  supabase: SupabaseClient,
  limit: number = RECORDING_BATCH_SIZE,
  now: Date = new Date(),
): Promise<ProcessRecordingsResult> {
  const cutoffIso = new Date(now.getTime() - PROCESSING_STALE_MS).toISOString();
  // Candidates are plain-pending rows PLUS abandoned-processing rows (a
  // crashed invocation left processing_at stale) -- the claim step below is
  // what actually guards against double-processing a row a concurrent,
  // still-live invocation is working on.
  const { data, error } = await supabase
    .from('call_recordings')
    .select('id, ghl_message_id, ghl_contact_id, ghl_user_id, direction, called_at, duration_seconds, status, processing_at')
    .or(`status.eq.pending,and(status.eq.processing,processing_at.lt.${cutoffIso})`)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;

  const rows = (data ?? []) as CallRecordingRow[];
  if (rows.length === 0) return { done: 0, skipped: 0, failed: 0 };

  const vertical = await resolveHolidayVertical(supabase).catch(() => null);

  let done = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    const claimed = await claimRecording(supabase, row, now);
    if (!claimed) continue; // another invocation claimed this row first -- not double-spent, not counted here
    const outcome = await processOneRecording(supabase, row, vertical);
    if (outcome === 'transcribed') done++;
    else if (outcome === 'skipped') skipped++;
    else failed++;
  }

  return { done, skipped, failed };
}
