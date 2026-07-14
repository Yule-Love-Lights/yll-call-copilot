// GET /api/cron/score-calls — scheduled counterpart to POST
// /api/scores/continue: scores up to BATCH_LIMIT unscored substantive
// transcripts, newest first, best-effort per transcript. Disabled by
// default: no-ops unless CRON_ENABLED=true, same env-gate-as-kill-switch
// convention as GHL_SEND_ENABLED and the existing /api/cron/brain-review.
//
// GET, not POST, because Vercel Cron Jobs only ever issue GET requests to
// the configured path (see vercel.json) -- this route is listed public in
// src/proxy.ts (no browser session exists for a cron-triggered request)
// with CRON_ENABLED as its own gate, same shape as
// /api/cron/brain-review.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { isClaudeConfigured } from '@/lib/claude';
import { scoreNextBatch } from '@/lib/scoring/batch';

export const maxDuration = 300;

// Best-effort per transcript inside scoreNextBatch means each cron tick is
// bounded work even if a batch hits a slow model response.
const BATCH_LIMIT = 8;

export async function GET() {
  if (process.env.CRON_ENABLED !== 'true') {
    return NextResponse.json({ ran: false, reason: 'CRON_ENABLED is not set.' });
  }
  if (!isSupabaseConfigured() || !isClaudeConfigured()) {
    return NextResponse.json({ ran: false, reason: 'Supabase or Claude not configured.' });
  }

  const supabase = getSupabaseServerClient()!;

  try {
    const result = await scoreNextBatch(supabase, BATCH_LIMIT);
    return NextResponse.json({ ran: true, ...result });
  } catch (err) {
    if (isMissingTableError(err)) {
      return NextResponse.json({ ran: false, reason: 'Run migration 0008 first.' });
    }
    console.error('Cron score-calls failed:', err);
    return NextResponse.json({ ran: false, reason: 'Scoring batch failed.' }, { status: 500 });
  }
}
