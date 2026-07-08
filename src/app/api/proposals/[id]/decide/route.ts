// POST /api/proposals/[id]/decide — body {approve: boolean}. Approve ->
// applies the proposal to the active playbook via the pure applyProposal()
// and publishes the result as a NEW playbook version (source: 'edited'),
// same "restore never rewrites history" convention as
// PUT /api/verticals/[id]/playbook. Reject -> marks the proposal rejected,
// no playbook change.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { applyProposal } from '@/lib/playbook/apply';
import type { Playbook, VerticalRow } from '@/lib/playbook/types';
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

  const { data: verticalData, error: verticalError } = await supabase
    .from('verticals')
    .select('id, active_version')
    .eq('id', proposal.vertical_id)
    .maybeSingle();
  if (verticalError || !verticalData) {
    console.error('Load vertical for proposal decide failed:', verticalError);
    return NextResponse.json(
      { configured: true, decided: false, reason: 'Could not load the vertical.' },
      { status: 500 },
    );
  }
  const vertical = verticalData as Pick<VerticalRow, 'id' | 'active_version'>;

  let currentPlaybook: Playbook | null = null;
  if (vertical.active_version > 0) {
    const { data: versionData } = await supabase
      .from('playbook_versions')
      .select('content')
      .eq('vertical_id', vertical.id)
      .eq('version', vertical.active_version)
      .maybeSingle();
    currentPlaybook = (versionData as { content: Playbook } | null)?.content ?? null;
  }
  if (!currentPlaybook) {
    return NextResponse.json(
      { configured: true, decided: false, reason: 'This vertical has no active playbook to apply the proposal to.' },
      { status: 409 },
    );
  }

  const nextPlaybook = applyProposal(currentPlaybook, proposal);
  const nextVersion = vertical.active_version + 1;

  const { error: insertError } = await supabase
    .from('playbook_versions')
    .insert({ vertical_id: vertical.id, version: nextVersion, content: nextPlaybook, source: 'edited' });
  if (insertError) {
    console.error('Store proposal-applied playbook failed:', insertError);
    return NextResponse.json(
      { configured: true, decided: false, reason: 'Could not store the updated playbook.' },
      { status: 500 },
    );
  }

  const { error: updateVerticalError } = await supabase
    .from('verticals')
    .update({ active_version: nextVersion })
    .eq('id', vertical.id);
  if (updateVerticalError) {
    console.error('Bump active_version for proposal decide failed:', updateVerticalError);
    return NextResponse.json(
      { configured: true, decided: false, reason: 'Could not activate the updated playbook.' },
      { status: 500 },
    );
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

  return NextResponse.json({ configured: true, decided: true, approved: true, version: nextVersion });
}
