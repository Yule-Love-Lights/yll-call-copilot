// POST /api/digest/generate -- the "Generate now" button on /digest. Staff
// session already gated by src/proxy.ts (this path is not public). Runs
// src/lib/digest/runDigest.ts in 'replace' mode: deletes and reinserts the
// current week's digest so a rep can re-run it after correcting a call score,
// mirroring POST /api/verticals/[id]/brain-review's manual re-run button.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { isClaudeConfigured } from '@/lib/claude';
import { runWeeklyDigest } from '@/lib/digest/runDigest';

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, generated: false, reason: 'Supabase not configured.' });
  }
  if (!isClaudeConfigured()) {
    return NextResponse.json({ configured: true, generated: false, reason: 'Claude not configured.' });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const periodDays = typeof body?.periodDays === 'number' ? body.periodDays : 7;

  const supabase = getSupabaseServerClient()!;
  const result = await runWeeklyDigest(supabase, { periodDays, mode: 'replace' });

  if (!result.ok) {
    // 'missing_table' degrades to a graceful 200 (same convention as every
    // other route in this app); 'generation_failed' is a 502 (the Claude
    // call itself failed, mirrors distill's/brain-review's 502);
    // everything else is an unexpected 500.
    if (result.kind === 'missing_table') {
      return NextResponse.json({ configured: true, generated: false, reason: result.reason });
    }
    const status = result.kind === 'generation_failed' ? 502 : 500;
    return NextResponse.json({ configured: true, generated: false, reason: result.reason }, { status });
  }

  return NextResponse.json({ configured: true, generated: true, digest: result.digest });
}
