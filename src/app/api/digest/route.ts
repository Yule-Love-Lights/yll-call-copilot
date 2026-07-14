// GET /api/digest -- the digest history for /digest: the newest digest plus
// a small history list, newest first. Digests are generated at most weekly,
// so the whole table is small forever (roughly 52 rows a year) -- returned
// in full (with content) rather than paginated, same "small enough, don't
// bother" reasoning as the rest of this app's list routes.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import type { DigestContent } from '@/lib/digest/runDigest';

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, digests: [] });
  }

  const supabase = getSupabaseServerClient()!;
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
