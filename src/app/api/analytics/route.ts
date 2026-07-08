// GET /api/analytics?vertical=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD — the stats
// tiles, outcome-by-opener table, version win-rate table, and calls/day
// trend for the /analytics page. from/to default to the last 30 days when
// missing or malformed (see parseDateRange). All the aggregation lives in
// src/lib/analytics/stats.ts, shared with POST
// /api/verticals/[id]/brain-review so both compute stats identically.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { loadStats, parseDateRange } from '@/lib/analytics/stats';
import type { VerticalRow } from '@/lib/playbook/types';

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const url = new URL(request.url);
  const verticalId = url.searchParams.get('vertical')?.trim();
  if (!verticalId) {
    return NextResponse.json({ configured: true, error: 'vertical is required.' }, { status: 400 });
  }
  const { from, to } = parseDateRange(url.searchParams.get('from'), url.searchParams.get('to'));

  const supabase = getSupabaseServerClient()!;

  const { data: verticalData, error: verticalError } = await supabase
    .from('verticals')
    .select('id, slug, name')
    .eq('id', verticalId)
    .maybeSingle();
  if (verticalError) {
    console.error('Load vertical for analytics failed:', verticalError);
    return NextResponse.json({ configured: true, error: 'Could not load vertical.' }, { status: 500 });
  }
  if (!verticalData) {
    return NextResponse.json({ configured: true, error: 'Vertical not found.' }, { status: 404 });
  }
  const vertical = verticalData as Pick<VerticalRow, 'id' | 'slug' | 'name'>;

  const result = await loadStats(supabase, { verticalId: vertical.id, verticalSlug: vertical.slug, from, to });
  if (!result.ok) {
    if (result.missingTable) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run the calls/live-coaching migrations (0002-0005) first.' });
    }
    return NextResponse.json({ configured: true, error: 'Could not load analytics.' }, { status: 500 });
  }

  return NextResponse.json({
    configured: true,
    vertical: { id: vertical.id, slug: vertical.slug, name: vertical.name },
    stats: result.stats,
  });
}
