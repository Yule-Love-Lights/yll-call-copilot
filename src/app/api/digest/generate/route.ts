// POST /api/digest/generate -- the "Generate now" button on /digest. Staff
// session already gated by src/proxy.ts (this path is not public), but that
// only checks the staff allowlist, not role -- owner-facing, not rep-facing,
// same reasoning as GET /api/digest (a rep re-generating still gets back
// every other rep's averages plus a named roughest moment). Runs
// src/lib/digest/runDigest.ts in 'replace' mode: deletes and reinserts the
// current week's digest so a rep can re-run it after correcting a call score,
// mirroring POST /api/verticals/[id]/brain-review's manual re-run button.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import { resolveStaffRole } from '@/lib/auth/role';
import { isClaudeConfigured } from '@/lib/claude';
import { runWeeklyDigest } from '@/lib/digest/runDigest';

// 120s, not 60s: this route makes a single large Claude call (the digest
// narrative + role-play generation over a full week of call_scores) and a
// slow generation getting killed by the function timeout skips that week's
// digest until someone notices and retries by hand.
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, generated: false, reason: 'Supabase not configured.' });
  }

  const supabase = getSupabaseServerClient()!;
  const role = await resolveStaffRole(supabase, await getSessionEmail());
  if (role === 'rep') {
    return NextResponse.json({ configured: true, generated: false, reason: "The weekly digest is for the coach's Friday review." }, { status: 403 });
  }

  if (!isClaudeConfigured()) {
    return NextResponse.json({ configured: true, generated: false, reason: 'Claude not configured.' });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const periodDays = typeof body?.periodDays === 'number' ? body.periodDays : 7;

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
