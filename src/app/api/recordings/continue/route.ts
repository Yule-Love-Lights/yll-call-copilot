// POST /api/recordings/continue — process the next batch of pending call
// recordings on demand (the /recordings page's "Process next batch"
// button), mirroring the bounded-batch-per-invocation chunking pattern
// POST /api/ingest/continue uses for transcript uploads. A normal
// staff-session route (proxy.ts's default auth applies — not public, unlike
// the nightly cron): a human is already signed in when they click it.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { processPendingRecordings } from '@/lib/recordings/pipeline';
import { RECORDING_BATCH_SIZE } from '@/lib/recordings/sync';

export const maxDuration = 300;

export async function POST() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, reason: 'Supabase not configured.' });
  }

  const supabase = getSupabaseServerClient()!;

  try {
    const result = await processPendingRecordings(supabase, RECORDING_BATCH_SIZE);
    return NextResponse.json({ configured: true, migrated: true, ...result });
  } catch (err) {
    if (isMissingTableError(err)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0007 first.' });
    }
    console.error('Process recordings batch failed:', err);
    return NextResponse.json({ configured: true, error: 'Could not process the batch.' }, { status: 500 });
  }
}
