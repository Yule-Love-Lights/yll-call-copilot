// GET /api/cron/second-mile — the nightly second-mile run: personal-touch
// scan over recent transcripts, the December 10-25 cookies+ornament run,
// and the reveal-photo prompt (see src/lib/secondMile/cron.ts for the real
// logic; this route is a thin wrapper, same shape as
// GET /api/cron/brain-review). CRON_SECRET authenticates the request and
// CRON_ENABLED remains an off-by-default kill switch.
//
// GET, not POST, because Vercel Cron Jobs only ever issue GET requests to
// the configured path (see vercel.json at the repo root) — this route is
// listed as route-authenticated in src/proxy.ts (no browser session exists for
// a cron-triggered request) and verifies the bearer credential here.
//
// Nothing here ever sends a message to a customer or crew member — every
// insert this run makes is a 'pending' checklist/draft row a human works
// from the /second-mile page; the two sendable kinds (reveal_photo,
// cold_snap_checkin) still require a human click on POST
// /api/second-mile/[id]/send, gated by GHL_SEND_ENABLED.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { isClaudeConfigured } from '@/lib/claude';
import { runSecondMileCron } from '@/lib/secondMile/cron';
import { verifyCronRequest } from '@/lib/auth/machine';

export const maxDuration = 120;

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
    const result = await runSecondMileCron(supabase);
    return NextResponse.json({ ran: true, result });
  } catch (err) {
    if (isMissingTableError(err)) {
      return NextResponse.json({ ran: false, reason: 'Run migration 0013 first.' });
    }
    console.error('Second-mile cron failed:', err);
    return NextResponse.json({ ran: false, reason: 'Second-mile cron failed.' }, { status: 500 });
  }
}
