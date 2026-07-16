// GET /api/cron/weekly-digest -- the self-generating Friday digest. Disabled
// by default: no-ops unless CRON_ENABLED=true is set, same kill-switch
// convention as GET /api/cron/brain-review. When enabled, runs
// src/lib/digest/runDigest.ts in 'skip-if-exists' mode -- idempotent per
// week, so a Vercel Cron retry (or the schedule firing twice) never produces
// a second digest for the same period; the unique(period_start, period_end)
// constraint (migration 0010) backs this up at the DB layer too.
//
// GET, not POST, because Vercel Cron Jobs only ever issue GET requests to
// the configured path (see vercel.json). Public in src/proxy.ts (no browser
// session exists for a cron-triggered request), same shape as
// /api/cron/brain-review.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { isClaudeConfigured } from '@/lib/claude';
import { runWeeklyDigest } from '@/lib/digest/runDigest';

export const maxDuration = 60;

export async function GET() {
  if (process.env.CRON_ENABLED !== 'true') {
    return NextResponse.json({ ran: false, reason: 'CRON_ENABLED is not set.' });
  }
  if (!isSupabaseConfigured() || !isClaudeConfigured()) {
    return NextResponse.json({ ran: false, reason: 'Supabase or Claude not configured.' });
  }

  const supabase = getSupabaseServerClient()!;
  const result = await runWeeklyDigest(supabase, { mode: 'skip-if-exists' });

  if (!result.ok) {
    console.error(`Cron weekly digest failed: ${result.reason}`);
    return NextResponse.json({ ran: false, reason: result.reason });
  }
  if (result.alreadyExisted) {
    return NextResponse.json({ ran: true, generated: false, reason: `Digest for ${result.digest.periodStart} to ${result.digest.periodEnd} already exists.` });
  }
  return NextResponse.json({ ran: true, generated: true, digestId: result.digest.id });
}
