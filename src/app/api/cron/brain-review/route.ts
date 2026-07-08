// GET /api/cron/brain-review — optional scheduled counterpart to the manual
// "Run weekly review" button. Disabled by default: no-ops unless
// CRON_ENABLED=true is set, same env-gate-as-kill-switch convention as
// GHL_SEND_ENABLED. When enabled, runs the same src/lib/analytics/
// runBrainReview.ts logic the manual POST /api/verticals/[id]/brain-review
// button uses, once per vertical, best-effort (one vertical's failure does
// not stop the rest).
//
// GET, not POST, because Vercel Cron Jobs only ever issue GET requests to
// the configured path (see vercel.json at the repo root) — this route is
// listed public in src/proxy.ts (no browser session exists for a
// cron-triggered request) with CRON_ENABLED as its own gate, same shape as
// the other public-but-self-gated routes (/api/webhooks/ghl,
// /api/twilio/voice, /api/live/segment). CRON_ENABLED is a soft kill switch,
// not a secret — deliberately proportionate to what this route does
// (compiles stats into a narrative + proposes playbook edits, nothing
// destructive), same risk posture as GHL_SEND_ENABLED.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { isClaudeConfigured } from '@/lib/claude';
import { runBrainReview } from '@/lib/analytics/runBrainReview';
import type { VerticalRow } from '@/lib/playbook/types';

export const maxDuration = 60;

export async function GET() {
  if (process.env.CRON_ENABLED !== 'true') {
    return NextResponse.json({ ran: false, reason: 'CRON_ENABLED is not set.' });
  }
  if (!isSupabaseConfigured() || !isClaudeConfigured()) {
    return NextResponse.json({ ran: false, reason: 'Supabase or Claude not configured.' });
  }

  const supabase = getSupabaseServerClient()!;

  const { data: verticalRows, error: verticalsError } = await supabase
    .from('verticals')
    .select('id, slug, name, active_version');
  if (verticalsError) {
    console.error('Load verticals for cron brain review failed:', verticalsError);
    return NextResponse.json({ ran: false, reason: 'Could not load verticals.' }, { status: 500 });
  }
  const verticals = (verticalRows ?? []) as Pick<VerticalRow, 'id' | 'slug' | 'name' | 'active_version'>[];

  const results: { verticalId: string; reviewed: boolean; reason?: string }[] = [];
  for (const vertical of verticals) {
    const result = await runBrainReview(
      supabase,
      { id: vertical.id, slug: vertical.slug, name: vertical.name, activeVersion: vertical.active_version },
      7,
    );
    if (result.ok) {
      results.push({ verticalId: vertical.id, reviewed: true });
    } else {
      console.error(`Cron brain review skipped vertical ${vertical.id}: ${result.reason}`);
      results.push({ verticalId: vertical.id, reviewed: false, reason: result.reason });
    }
  }

  return NextResponse.json({ ran: true, results });
}
