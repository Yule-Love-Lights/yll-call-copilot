// GET /api/cron/sync-recordings — nightly Vercel Cron entry (see
// vercel.json) for Workstream 1's recordings pipeline
// (docs/SALES-EXCELLENCE-PLAN.md section 4): pulls newly-completed call
// messages from GoHighLevel since the last sync, upserts them into
// call_recordings (idempotent on ghl_message_id — a re-run never
// double-inserts the same call), stamps recording_sync_state, then
// processes up to RECORDING_BATCH_SIZE pending recordings in this same
// invocation. Same shape as /api/cron/brain-review: GET only (Vercel Cron
// only ever issues GET), listed public in src/proxy.ts (no browser session
// on a cron-triggered request). CRON_SECRET authenticates the caller;
// CRON_ENABLED remains a separate off-by-default kill switch.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { isHighLevelConfigured } from '@/lib/ghl/client';
import { listRecentCallRecordings } from '@/lib/ghl/recordings';
import { processPendingRecordings } from '@/lib/recordings/pipeline';
import { RECORDING_BATCH_SIZE, resolveSyncWindowStart } from '@/lib/recordings/sync';
import { verifyCronRequest } from '@/lib/auth/machine';

const BACKLOG_FETCH_LIMIT = 500;
// HighLevel can make a completed call visible after its dateAdded timestamp.
// Re-scan one day on every completed window; ghl_message_id makes the overlap
// idempotent, while delayed provider visibility no longer creates a hole.
const PROVIDER_VISIBILITY_OVERLAP_MS = 24 * 60 * 60 * 1000;

export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = verifyCronRequest(request);
  if (auth !== 'authorized') {
    // 503 vs 401 is the whole diagnosis and it used to be invisible: both
    // returned the same {"error":"Unauthorized"} body. 'unconfigured' means
    // CRON_SECRET is absent or under 16 chars, so EVERY caller is rejected --
    // including Vercel Cron itself. That silently dark-ed this pipeline for
    // eight days (2026-08-08 to 2026-08-16, zero calls captured) while the
    // body said "Unauthorized", which reads like a caller problem rather than
    // a server misconfiguration. Names the variable, never its value.
    return auth === 'unconfigured'
      ? NextResponse.json(
          {
            error: 'CRON_SECRET is not configured',
            code: 'CRON_SECRET_UNCONFIGURED',
            hint: 'Set CRON_SECRET (16+ chars) in this environment; every cron caller is rejected until then.',
          },
          { status: 503 },
        )
      : NextResponse.json({ error: 'Unauthorized', code: 'CRON_AUTH_DENIED' }, { status: 401 });
  }
  if (process.env.CRON_ENABLED !== 'true') {
    return NextResponse.json({ ran: false, reason: 'CRON_ENABLED is not set.' });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ran: false, reason: 'Supabase not configured.' });
  }
  if (!isHighLevelConfigured()) {
    return NextResponse.json({ ran: false, reason: 'HighLevel not configured.' });
  }

  const supabase = getSupabaseServerClient()!;

  try {
    const { data: stateData, error: stateError } = await supabase
      .from('recording_sync_state')
      .select('last_synced_at')
      .eq('id', 1)
      .maybeSingle();
    if (stateError) throw stateError;
    const lastSyncedAt = (stateData as { last_synced_at: string | null } | null)?.last_synced_at ?? null;
    const since = resolveSyncWindowStart(lastSyncedAt);

    // Captured BEFORE the GHL fetch, not after: if a call's dateAdded lands
    // during the fetch (the fetch takes a few seconds, GHL keeps logging
    // calls the whole time), stamping a post-fetch time would push the next
    // run's `since` past that call, permanently skipping it. The
    // ghl_message_id unique constraint below already dedupes the resulting
    // small overlap between runs, so re-seeing a few of the same messages
    // next time is free.
    const runStartedAt = new Date().toISOString();
    // The fetcher scans the reachable time window, sorts matching calls oldest
    // first, and returns at most this many timestamp groups. Five hundred
    // covers the measured 2026-08 gap (129 calls) in one database batch while
    // still allowing a larger backlog to drain over successive safe cursors.
    const { messages, truncated, stopReason, nextSince } = await listRecentCallRecordings(
      since,
      BACKLOG_FETCH_LIMIT,
      runStartedAt,
    );

    let inserted = 0;
    let upsertFailed = 0;
    for (const m of messages) {
      // ignoreDuplicates + the unique(ghl_message_id) constraint is the
      // idempotency key: a message already seen on a previous run silently
      // no-ops instead of erroring or creating a second row.
      const { data, error } = await supabase
        .from('call_recordings')
        .upsert(
          {
            ghl_message_id: m.messageId,
            ghl_contact_id: m.contactId,
            ghl_conversation_id: m.conversationId,
            ghl_user_id: m.userId,
            direction: m.direction,
            called_at: m.dateAdded,
            duration_seconds: m.durationSeconds,
          },
          { onConflict: 'ghl_message_id', ignoreDuplicates: true },
        )
        .select('id');
      if (error) {
        console.error('Upsert call_recordings failed:', error);
        upsertFailed++;
        continue;
      }
      if (data && data.length > 0) inserted++;
    }

    // The export fetcher supplies an exclusive continuation only after it has
    // crossed the entire boundary timestamp. A completed window deliberately
    // keeps a one-day overlap for provider visibility lag.
    const overlapCursor = new Date(Math.max(
      new Date(since).getTime(),
      new Date(runStartedAt).getTime() - PROVIDER_VISIBILITY_OVERLAP_MS,
    )).toISOString();
    const requestedNextCursor = upsertFailed > 0
      ? since
      : !truncated
      ? overlapCursor
      : nextSince
        ? nextSince
        : since;

    // The database routine takes a row lock and applies GREATEST, so a stale
    // overlapping cron invocation can never move a newer cursor backward.
    const { data: storedCursor, error: syncStateError } = await supabase.rpc(
      'advance_recording_sync_cursor',
      {
        p_next_cursor: requestedNextCursor,
        p_detail: {
          messages_seen: messages.length,
          inserted,
          upsert_failed: upsertFailed,
          truncated,
          stop_reason: stopReason,
          visibility_overlap_hours: PROVIDER_VISIBILITY_OVERLAP_MS / (60 * 60 * 1000),
        },
      },
    );
    if (syncStateError) throw syncStateError;
    const actualCursor = typeof storedCursor === 'string' ? storedCursor : requestedNextCursor;
    const cursorHeld = actualCursor === since;

    const result = await processPendingRecordings(supabase, RECORDING_BATCH_SIZE);

    return NextResponse.json({
      ran: true,
      since,
      messagesSeen: messages.length,
      inserted,
      upsertFailed,
      truncated,
      stopReason,
      cursorHeld,
      ...result,
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      return NextResponse.json({ ran: false, migrated: false, reason: 'Run migrations through 0024 first.' });
    }
    console.error('Cron sync-recordings failed:', err);
    return NextResponse.json({ ran: false, error: 'Sync failed.' }, { status: 500 });
  }
}
