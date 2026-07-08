// POST /api/queue/build — the "Build queue" button. Runs buildQueue() (see
// src/lib/leads/queue.ts): pulls the three lead sources from GoHighLevel and
// upserts scored candidates into `leads`. No cron — this only ever runs when
// a human clicks the button.
//
// `maxDuration` is generous because a quote-follow-up match without an
// embedded contact falls back to one getContact() call per opportunity,
// sequential with a 150ms gap, up to 100 of them.

import { NextResponse } from 'next/server';
import { isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { isHighLevelConfigured } from '@/lib/ghl/client';
import { buildQueue } from '@/lib/leads/queue';

export const maxDuration = 300;

export async function POST() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, reason: 'Supabase not configured.' });
  }
  if (!isHighLevelConfigured()) {
    return NextResponse.json({ configured: true, reason: 'HighLevel not configured.' });
  }

  try {
    const result = await buildQueue();
    return NextResponse.json({ configured: true, migrated: true, ...result });
  } catch (err) {
    if (isMissingTableError(err)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0004 first.' });
    }
    console.error('Build queue failed:', err);
    return NextResponse.json({ configured: true, error: 'Could not build the queue.' }, { status: 500 });
  }
}
