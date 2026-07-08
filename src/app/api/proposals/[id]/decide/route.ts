// POST /api/proposals/[id]/decide — body {approve: boolean}. Approve ->
// applies the proposal to the active playbook via the pure applyProposal()
// and publishes the result as a NEW playbook version (source: 'edited'),
// same "restore never rewrites history" convention as
// PUT /api/verticals/[id]/playbook. Reject -> marks the proposal rejected,
// no playbook change.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { applyProposal } from '@/lib/playbook/apply';
import { publishPlaybookVersion } from '@/lib/playbook/versions';
import type { Playbook } from '@/lib/playbook/types';
import type { PlaybookProposalRow } from '@/lib/transcripts/types';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, decided: false, reason: 'Supabase not configured.' });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const approve = body?.approve === true;

  const supabase = getSupabaseServerClient()!;

  const { data: proposalData, error: proposalError } = await supabase
    .from('playbook_proposals')
    .select('id, vertical_id, section, kind, current_value, proposed_value, evidence, status')
    .eq('id', id)
    .maybeSingle();
  if (proposalError) {
    if (isMissingTableError(proposalError)) {
      return NextResponse.json({ configured: true, decided: false, reason: 'Run migration 0003 first.' });
    }
    console.error('Load proposal failed:', proposalError);
    return NextResponse.json(
      { configured: true, decided: false, reason: 'Could not load the proposal.' },
      { status: 500 },
    );
  }
  if (!proposalData) {
    return NextResponse.json({ configured: true, decided: false, reason: 'Proposal not found.' }, { status: 404 });
  }
  const proposal = proposalData as Pick<
    PlaybookProposalRow,
    'id' | 'vertical_id' | 'section' | 'kind' | 'current_value' | 'proposed_value' | 'evidence' | 'status'
  >;

  if (proposal.status !== 'pending') {
    return NextResponse.json(
      { configured: true, decided: false, reason: 'This proposal was already decided.' },
      { status: 409 },
    );
  }

  if (!approve) {
    const { error: rejectError } = await supabase
      .from('playbook_proposals')
      .update({ status: 'rejected', decided_at: new Date().toISOString() })
      .eq('id', id);
    if (rejectError) {
      console.error('Reject proposal failed:', rejectError);
      return NextResponse.json(
        { configured: true, decided: false, reason: 'Could not reject the proposal.' },
        { status: 500 },
      );
    }
    return NextResponse.json({ configured: true, decided: true, approved: false });
  }

  // publishPlaybookVersion re-reads active_version fresh on every attempt
  // and retries once on a version-number collision (two proposals approved
  // back to back for the same vertical) — resolveContent below runs again
  // on that retry too, so a collision re-reads the CURRENT playbook rather
  // than re-applying the proposal to a base that's since gone stale.
  const result = await publishPlaybookVersion(supabase, proposal.vertical_id, 'edited', async activeVersion => {
    let currentPlaybook: Playbook | null = null;
    if (activeVersion > 0) {
      const { data: versionData } = await supabase
        .from('playbook_versions')
        .select('content')
        .eq('vertical_id', proposal.vertical_id)
        .eq('version', activeVersion)
        .maybeSingle();
      currentPlaybook = (versionData as { content: Playbook } | null)?.content ?? null;
    }
    if (!currentPlaybook) {
      return { ok: false, error: 'This vertical has no active playbook to apply the proposal to.', status: 409 };
    }

    // A malformed proposal (wrong-shaped proposed_value, or a change/remove
    // whose current_value matches nothing) must not be marked approved —
    // applyProposal now reports that instead of silently returning the
    // playbook unchanged (the H8/M4 review findings).
    const applied = applyProposal(currentPlaybook, proposal);
    if (!applied.applied) {
      return { ok: false, error: applied.reason, status: 422 };
    }
    return { ok: true, playbook: applied.playbook };
  });

  if (!result.ok) {
    return NextResponse.json({ configured: true, decided: false, reason: result.reason }, { status: result.status });
  }

  const { error: approveError } = await supabase
    .from('playbook_proposals')
    .update({ status: 'approved', decided_at: new Date().toISOString() })
    .eq('id', id);
  if (approveError) {
    // Non-fatal: the playbook change already landed as the new active
    // version. The proposal's own status is bookkeeping on top of that, so
    // report success rather than making the caller think nothing happened.
    console.error('Mark proposal approved failed:', approveError);
  }

  return NextResponse.json({ configured: true, decided: true, approved: true, version: result.version });
}
