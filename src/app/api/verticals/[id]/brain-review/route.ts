// GET /api/verticals/[id]/brain-review — the latest saved review for this
// vertical, for the /analytics page's narrative + "Run weekly review"
// button. Mirrors GET /api/verticals/[id]/insights's "no vertical-existence
// check, just return what's there" leniency.
//
// POST .../brain-review {periodDays?=7} — runs a new one now. The actual
// work (stats, learnings, playbook, the Claude call, storing everything) is
// src/lib/analytics/runBrainReview.ts, shared with the optional
// GET /api/cron/brain-review so there is one place it lives. Proposals land
// as ordinary pending playbook_proposals rows — the SAME table and
// approve/reject route Wave B's distill already uses (POST
// /api/proposals/[id]/decide), rendered by the SAME InsightsPanel on
// /verticals/[id] — no second proposals system.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { isClaudeConfigured } from '@/lib/claude';
import { runBrainReview } from '@/lib/analytics/runBrainReview';
import type { VerticalRow } from '@/lib/playbook/types';

export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, latest: null });
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient()!;

  const { data, error } = await supabase
    .from('brain_reviews')
    .select('id, period_start, period_end, narrative, proposals_created, created_at')
    .eq('vertical_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0006 first.', latest: null });
    }
    console.error('Load latest brain review failed:', error);
    return NextResponse.json({ configured: true, error: 'Could not load the latest review.', latest: null }, { status: 500 });
  }

  return NextResponse.json({
    configured: true,
    latest: data
      ? {
          id: data.id as string,
          periodStart: data.period_start as string,
          periodEnd: data.period_end as string,
          narrative: data.narrative as string,
          proposalsCreated: data.proposals_created as number,
          createdAt: data.created_at as string,
        }
      : null,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, reviewed: false, reason: 'Supabase not configured.' });
  }
  if (!isClaudeConfigured()) {
    return NextResponse.json({ configured: true, reviewed: false, reason: 'Claude not configured.' });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const periodDays = typeof body?.periodDays === 'number' ? body.periodDays : 7;

  const supabase = getSupabaseServerClient()!;

  const { data: verticalData, error: verticalError } = await supabase
    .from('verticals')
    .select('id, slug, name, active_version')
    .eq('id', id)
    .maybeSingle();
  if (verticalError) {
    console.error('Load vertical for brain review failed:', verticalError);
    return NextResponse.json({ configured: true, reviewed: false, reason: 'Could not load vertical.' }, { status: 500 });
  }
  if (!verticalData) {
    return NextResponse.json({ configured: true, reviewed: false, reason: 'Vertical not found.' }, { status: 404 });
  }
  const vertical = verticalData as Pick<VerticalRow, 'id' | 'slug' | 'name' | 'active_version'>;

  const result = await runBrainReview(
    supabase,
    { id: vertical.id, slug: vertical.slug, name: vertical.name, activeVersion: vertical.active_version },
    periodDays,
  );
  if (!result.ok) {
    // 'missing_table' degrades to a 200 (same graceful-degradation
    // convention as every other route); 'generation_failed' is a 502 (the
    // Claude call itself failed, mirrors distill's 502); everything else is
    // an unexpected 500.
    if (result.kind === 'missing_table') {
      return NextResponse.json({ configured: true, reviewed: false, reason: result.reason });
    }
    const status = result.kind === 'generation_failed' ? 502 : 500;
    return NextResponse.json({ configured: true, reviewed: false, reason: result.reason }, { status });
  }

  return NextResponse.json({ configured: true, reviewed: true, review: result.review });
}
