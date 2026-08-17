// GET /api/cron/score-calls — scheduled counterpart to POST
// /api/scores/continue: scores up to BATCH_LIMIT unscored substantive
// transcripts, newest first, best-effort per transcript. CRON_SECRET
// authenticates the request and CRON_ENABLED remains an off-by-default kill
// switch.
//
// GET, not POST, because Vercel Cron Jobs only ever issue GET requests to
// the configured path (see vercel.json) -- this route is listed public in
// src/proxy.ts (no browser session exists for a cron-triggered request) and
// authenticates inside this handler, same shape as /api/cron/brain-review.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { isClaudeConfigured } from '@/lib/claude';
import { scoreNextBatch } from '@/lib/scoring/batch';
import { verifyCronRequest } from '@/lib/auth/machine';

export const maxDuration = 300;

// Best-effort per transcript inside scoreNextBatch means each cron tick is
// bounded work even if a batch hits a slow model response.
const BATCH_LIMIT = 8;

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
