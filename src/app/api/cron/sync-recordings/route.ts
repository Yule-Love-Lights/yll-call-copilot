// GET /api/cron/sync-recordings — nightly Vercel Cron entry (see
// vercel.json) for Workstream 1's recordings pipeline
// (docs/SALES-EXCELLENCE-PLAN.md section 4): pulls newly-completed call
// messages from GoHighLevel since the last sync, upserts them into
// call_recordings (idempotent on ghl_message_id — a re-run never
// double-inserts the same call), stamps recording_sync_state, then
// processes up to RECORDING_BATCH_SIZE pending recordings in this same
// invocation. Same shape as /api/cron/brain-review: GET only (Vercel Cron
// only ever issues GET), listed public in src/proxy.ts (no browser session
// on a cron-triggered request), gated by CRON_ENABLED (off by default) —
// same soft-kill-switch posture as the other cron/self-gated routes. If
// CRON_SECRET is also set, the request must additionally carry the matching
// bearer token (see src/lib/cronAuth.ts) before CRON_ENABLED is even checked.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { isHighLevelConfigured } from '@/lib/ghl/client';
import { listRecentCallRecordings } from '@/lib/ghl/recordings';
import { processPendingRecordings } from '@/lib/recordings/pipeline';
import { RECORDING_BATCH_SIZE, resolveSyncWindowStart } from '@/lib/recordings/sync';
import { isCronRequestAuthorized } from '@/lib/cronAuth';

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    const messages = await listRecentCallRecordings(since);

    let inserted = 0;
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
        continue;
      }
      if (data && data.length > 0) inserted++;
    }

    await supabase.from('recording_sync_state').upsert({
      id: 1,
      last_synced_at: runStartedAt,
      detail: { messages_seen: messages.length, inserted },
    });

    const result = await processPendingRecordings(supabase, RECORDING_BATCH_SIZE);

    return NextResponse.json({ ran: true, since, messagesSeen: messages.length, inserted, ...result });
  } catch (err) {
    if (isMissingTableError(err)) {
      return NextResponse.json({ ran: false, migrated: false, reason: 'Run migration 0007 first.' });
    }
    console.error('Cron sync-recordings failed:', err);
    return NextResponse.json({ ran: false, error: 'Sync failed.' }, { status: 500 });
  }
}
