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
import { verifyCronRequest } from '@/lib/auth/machine';

export const maxDuration = 60;

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
