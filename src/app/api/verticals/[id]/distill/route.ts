// POST /api/verticals/[id]/distill — loads the /insights aggregate plus the
// vertical's active playbook, makes one Claude call (distillProposals), and
// inserts up to 10 playbook_proposals rows as 'pending'. Answers 200s with
// a reason when Supabase/Claude are missing or there is nothing to distill
// yet, never a 500 on missing config.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { isClaudeConfigured } from '@/lib/claude';
import { computeInsights } from '@/lib/transcripts/insights';
import { distillProposals } from '@/lib/transcripts/distill';
import type { Playbook, VerticalRow } from '@/lib/playbook/types';

export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, distilled: false, reason: 'Supabase not configured.' });
  }
  if (!isClaudeConfigured()) {
    return NextResponse.json({ configured: true, distilled: false, reason: 'Claude not configured.' });
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient()!;

  const insights = await computeInsights(supabase, id);
  if (!insights.ok) {
    if (insights.missingTable) {
      return NextResponse.json({ configured: true, distilled: false, reason: 'Run migration 0003 first.' });
    }
    return NextResponse.json(
      { configured: true, distilled: false, reason: 'Could not load insights.' },
      { status: 500 },
    );
  }
  if (insights.extractedCalls === 0) {
    return NextResponse.json({
      configured: true,
      distilled: false,
      reason: 'No extracted calls yet for this vertical — ingest and extract transcripts first.',
    });
  }

  const { data: verticalData, error: verticalError } = await supabase
    .from('verticals')
    .select('id, active_version')
    .eq('id', id)
    .maybeSingle();
  if (verticalError) {
    console.error('Load vertical for distill failed:', verticalError);
    return NextResponse.json(
      { configured: true, distilled: false, reason: 'Could not load vertical.' },
      { status: 500 },
    );
  }
  if (!verticalData) {
    return NextResponse.json({ configured: true, distilled: false, reason: 'Vertical not found.' }, { status: 404 });
  }
  const vertical = verticalData as Pick<VerticalRow, 'id' | 'active_version'>;

  let playbook: Playbook | null = null;
  if (vertical.active_version > 0) {
    const { data: versionData } = await supabase
      .from('playbook_versions')
      .select('content')
      .eq('vertical_id', id)
      .eq('version', vertical.active_version)
      .maybeSingle();
    playbook = (versionData as { content: Playbook } | null)?.content ?? null;
  }

  let proposals;
  try {
    proposals = await distillProposals({ aggregate: insights.aggregate, playbook });
  } catch (err) {
    console.error('Distill proposals failed:', err);
    return NextResponse.json(
      { configured: true, distilled: false, reason: 'Proposal distillation failed.' },
      { status: 502 },
    );
  }

  if (proposals.length === 0) {
    return NextResponse.json({ configured: true, distilled: true, count: 0 });
  }

  const { error: insertError } = await supabase.from('playbook_proposals').insert(
    proposals.map(p => ({
      vertical_id: id,
      section: p.section,
      kind: p.kind,
      current_value: p.current_value,
      proposed_value: p.proposed_value,
      evidence: p.evidence,
    })),
  );
  if (insertError) {
    if (isMissingTableError(insertError)) {
      return NextResponse.json({ configured: true, distilled: false, reason: 'Run migration 0003 first.' });
    }
    console.error('Insert proposals failed:', insertError);
    return NextResponse.json(
      { configured: true, distilled: false, reason: 'Could not store the proposals.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ configured: true, distilled: true, count: proposals.length });
}
