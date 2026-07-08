// GET /api/verticals/[id]/insights — aggregates learnings for the vertical:
// objection frequency (top 10 with % of extracted calls), most common
// customer questions, top what_worked/what_failed items, sample price_talk
// snippets, and booked/not_booked/unknown counts. Plain JSON, computed in
// JS from the raw learnings + transcripts rows — see
// src/lib/transcripts/insights.ts (shared with the distill route).

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { computeInsights } from '@/lib/transcripts/insights';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient()!;

  const result = await computeInsights(supabase, id);
  if (!result.ok) {
    if (result.missingTable) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0003 first.' });
    }
    return NextResponse.json({ configured: true, error: 'Could not load insights.' }, { status: 500 });
  }

  // The brief's API list has no standalone "list proposals" route, and the
  // Insights section is where the UI needs them (a "Propose playbook
  // updates" button right next to the pending proposals it produces) — so
  // pending proposals ride along on this response instead of a new route.
  const { data: proposalRows } = await supabase
    .from('playbook_proposals')
    .select('id, section, kind, current_value, proposed_value, evidence, status, created_at')
    .eq('vertical_id', id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  return NextResponse.json({
    configured: true,
    insights: result.aggregate,
    extractedCalls: result.extractedCalls,
    proposals: (proposalRows ?? []).map(p => ({
      id: p.id as string,
      section: p.section as string,
      kind: p.kind as string,
      currentValue: p.current_value,
      proposedValue: p.proposed_value,
      evidence: p.evidence as string,
      createdAt: p.created_at as string,
    })),
  });
}
