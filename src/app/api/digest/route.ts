// GET /api/digest -- the digest history for /digest: the newest digest plus
// a small history list, newest first. Digests are generated at most weekly,
// so the whole table is small forever (roughly 52 rows a year) -- returned
// in full (with content) rather than paginated, same "small enough, don't
// bother" reasoning as the rest of this app's list routes.
//
// Owner-facing, not rep-facing: the digest names a specific rep's roughest
// moment with the verbatim transcript quote, which must stay a private
// coaching conversation, not something every rep can pull for every other
// rep. proxy.ts only checks the staff allowlist (any signed-in rep passes),
// so the role check happens here.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import { resolveStaffRole } from '@/lib/auth/role';
import type { DigestContent } from '@/lib/digest/runDigest';

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, digests: [] });
  }

  const supabase = getSupabaseServerClient()!;
  const role = await resolveStaffRole(supabase, await getSessionEmail());
  if (role === 'rep') {
    return NextResponse.json({ configured: true, error: "The weekly digest is for the coach's Friday review." }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('weekly_digests')
    .select('id, period_start, period_end, content, created_at')
    .order('period_end', { ascending: false })
    .limit(20);
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migrations 0008 and 0010 first.', digests: [] });
    }
    console.error('Load weekly digests failed:', error);
    return NextResponse.json({ configured: true, error: 'Could not load digests.', digests: [] }, { status: 500 });
  }

  const rows = (data ?? []) as { id: string; period_start: string; period_end: string; content: DigestContent; created_at: string }[];
  return NextResponse.json({
    configured: true,
    digests: rows.map(r => ({ id: r.id, periodStart: r.period_start, periodEnd: r.period_end, content: r.content, createdAt: r.created_at })),
  });
}
