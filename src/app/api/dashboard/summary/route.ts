// GET /api/dashboard/summary — the dashboard's this-week stat row (calls,
// interested, queue depth, inbound pops) plus the single most-recently-run
// brain review across every vertical, for its one-liner. Calls/interested
// are global (every vertical), so this runs a couple of plain counts
// directly on `calls` rather than looping every vertical through the
// vertical-scoped src/lib/analytics/stats.ts loader that GET /api/analytics
// uses. Each piece degrades to its zero/null value independently on a
// missing table instead of failing the whole summary — the dashboard is the
// one page that should never show a hard error banner.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { dateRangeToTimestamps, periodFromDays } from '@/lib/analytics/stats';

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const supabase = getSupabaseServerClient()!;
  const { periodStart, periodEnd } = periodFromDays(7);
  const { startIso, endIso } = dateRangeToTimestamps(periodStart, periodEnd);

  let calls = 0;
  let interested = 0;
  const { data: callRows, error: callsError } = await supabase
    .from('calls')
    .select('outcome')
    .gte('started_at', startIso)
    .lte('started_at', endIso);
  if (callsError && !isMissingTableError(callsError)) {
    console.error('Load calls for dashboard summary failed:', callsError);
  }
  if (callRows) {
    const rows = callRows as { outcome: string | null }[];
    calls = rows.length;
    interested = rows.filter(r => r.outcome === 'interested').length;
  }

  const { count: queueCount, error: queueError } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .in('status', ['queued', 'claimed']);
  if (queueError && !isMissingTableError(queueError)) {
    console.error('Load queue depth for dashboard summary failed:', queueError);
  }

  const { count: inboundCount, error: inboundError } = await supabase
    .from('events_log')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'inbound_call')
    .gte('created_at', startIso)
    .lte('created_at', endIso);
  if (inboundError && !isMissingTableError(inboundError)) {
    console.error('Load inbound pops for dashboard summary failed:', inboundError);
  }

  let latestBrainReview: { verticalName: string; narrative: string; createdAt: string } | null = null;
  const { data: reviewData, error: reviewError } = await supabase
    .from('brain_reviews')
    .select('vertical_id, narrative, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reviewError && !isMissingTableError(reviewError)) {
    console.error('Load latest brain review for dashboard summary failed:', reviewError);
  }
  if (reviewData) {
    const review = reviewData as { vertical_id: string | null; narrative: string; created_at: string };
    let verticalName = '(unknown vertical)';
    if (review.vertical_id) {
      const { data: verticalData } = await supabase.from('verticals').select('name').eq('id', review.vertical_id).maybeSingle();
      verticalName = (verticalData as { name: string } | null)?.name ?? verticalName;
    }
    latestBrainReview = { verticalName, narrative: review.narrative, createdAt: review.created_at };
  }

  return NextResponse.json({
    configured: true,
    calls,
    interested,
    queueDepth: queueCount ?? 0,
    inboundPops: inboundCount ?? 0,
    latestBrainReview,
  });
}
