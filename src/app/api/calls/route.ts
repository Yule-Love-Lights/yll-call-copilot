// Completes one assigned lead call. The database owns the manual/live branch,
// immutable actor check, open-session guard, transcript link, outcome, lead
// completion, and retry idempotency in one transaction. Claude extraction and
// draft generation run only after that transaction succeeds.

import { NextResponse } from 'next/server';
import { isClaudeConfigured } from '@/lib/claude';
import { resolveCurrentHubActor } from '@/lib/auth/resource';
import { generateFollowups } from '@/lib/leads/followups';
import { validateCallInput } from '@/lib/leads/calls';
import { FOLLOWUP_OUTCOMES, type LeadRow } from '@/lib/leads/types';
import type { Playbook, VerticalRow } from '@/lib/playbook/types';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { processTranscriptBatch } from '@/lib/transcripts/process';
import { getContact, getOpportunitiesForContact, getStageNameMap, isHighLevelConfigured } from '@/lib/ghl/client';
import { isCallable } from '@/lib/leads/scoring';

export const maxDuration = 120;

type CompletionResult = {
  result_code: string;
  call_id: string | null;
  session_id: string | null;
  transcript_id: string | null;
  status: string | null;
};

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' }, { status: 503 });
  }
  const validation = validateCallInput(await request.json().catch(() => null));
  if (!validation.valid) {
    return NextResponse.json({ configured: true, saved: false, error: validation.error }, { status: 400 });
  }
  const input = validation.input;
  const actorResolution = await resolveCurrentHubActor();
  if (actorResolution.status !== 'resolved') {
    return NextResponse.json(
      { configured: true, saved: false, error: 'Access denied.' },
      { status: actorResolution.status === 'unavailable' ? 503 : 403 },
    );
  }
  const actor = actorResolution.actor;

  const supabase = getSupabaseServerClient()!;
  async function completeWithPermission(verifiedContactId: string | null, permissionVerified: boolean) {
    return supabase.rpc('complete_owned_lead_call', {
      p_actor_employee_id: actor.employeeId,
      p_actor_auth_user_id: actor.authUserId,
      p_actor_email: actor.email,
      p_lead_id: input.leadId,
      p_completion_request_id: input.completionRequestId,
      p_session_id: input.sessionId,
      p_outcome: input.outcome,
      p_notes: input.notes,
      p_raw_transcript: input.transcript,
      p_verified_contact_id: verifiedContactId,
      p_call_permission_verified: permissionVerified,
    });
  }

  // First ask the transaction whether this is an exact retry of a completion
  // that already committed. That recovery path must still work if HighLevel
  // is temporarily unavailable or the customer opts out after the call. A
  // fresh manual completion cannot write on this probe: SQL returns
  // call_not_authorized until the current contact permission is verified.
  // An owned pending live attempt was already permission-bound at dial time,
  // so saving its outcome can complete on this first call without contacting
  // the customer again.
  let completion = await completeWithPermission(null, false);
  if (completion.error) {
    if (isMissingTableError(completion.error)) {
      return NextResponse.json({ configured: true, saved: false, migrated: false, reason: 'Run migration 0020 first.' });
    }
    console.error('Complete lead call failed:', completion.error);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not save the call.' }, { status: 500 });
  }
  let result = (Array.isArray(completion.data) ? completion.data[0] : completion.data) as CompletionResult | null;

  if (result?.result_code === 'call_not_authorized') {
    if (!isHighLevelConfigured()) {
      return NextResponse.json(
        { configured: true, saved: false, error: 'Current customer call permission is unavailable.' },
        { status: 503 },
      );
    }
    const { data: permissionLead, error: permissionLeadError } = await supabase
      .from('leads')
      .select('ghl_contact_id')
      .eq('id', input.leadId)
      .maybeSingle();
    const verifiedContactId = (permissionLead as { ghl_contact_id?: string | null } | null)?.ghl_contact_id ?? null;
    if (permissionLeadError || !verifiedContactId) {
      return NextResponse.json(
        { configured: true, saved: false, error: 'Current customer call permission is unavailable.' },
        { status: permissionLeadError ? 503 : 409 },
      );
    }
    try {
      const [contact, opportunities, stageNames] = await Promise.all([
        getContact(verifiedContactId),
        getOpportunitiesForContact(verifiedContactId),
        getStageNameMap(),
      ]);
      const currentStages = opportunities
        .map(opportunity => opportunity.pipelineStageId ? stageNames.get(opportunity.pipelineStageId) : null)
        .filter((stage): stage is string => !!stage);
      if (!isCallable({
        dnd: contact.dnd,
        dndSettings: contact.dndSettings,
        tags: contact.tags ?? [],
        stageNames: currentStages,
      })) {
        return NextResponse.json(
          { configured: true, saved: false, error: 'This customer cannot be called.' },
          { status: 409 },
        );
      }
    } catch (caught) {
      console.error('Verify current call permission before completion failed:', caught);
      return NextResponse.json(
        { configured: true, saved: false, error: 'Current customer call permission is unavailable.' },
        { status: 503 },
      );
    }

    completion = await completeWithPermission(verifiedContactId, true);
    if (completion.error) {
      console.error('Complete verified lead call failed:', completion.error);
      return NextResponse.json({ configured: true, saved: false, error: 'Could not save the call.' }, { status: 500 });
    }
    result = (Array.isArray(completion.data) ? completion.data[0] : completion.data) as CompletionResult | null;
  }

  if (!result) {
    return NextResponse.json({ configured: true, saved: false, error: 'Could not save the call.' }, { status: 500 });
  }
  if (result.result_code === 'lead_missing') {
    return NextResponse.json({ configured: true, saved: false, error: 'Lead not found.' }, { status: 404 });
  }
  if (result.result_code === 'invalid_input') {
    return NextResponse.json({ configured: true, saved: false, error: 'Invalid call details.' }, { status: 400 });
  }
  if (['actor_inactive', 'not_claimed_by_actor'].includes(result.result_code)) {
    return NextResponse.json({ configured: true, saved: false, error: 'This lead is not assigned to you.' }, { status: 403 });
  }
  if (result.result_code === 'request_conflict') {
    return NextResponse.json({ configured: true, saved: false, error: 'This retry does not match the original saved call.' }, { status: 409 });
  }
  if (result.result_code === 'call_not_authorized') {
    return NextResponse.json(
      { configured: true, saved: false, error: 'This customer cannot be called.' },
      { status: 409 },
    );
  }
  if (!['completed', 'already_completed'].includes(result.result_code) || !result.call_id) {
    return NextResponse.json(
      { configured: true, saved: false, error: 'End the open live call before saving its outcome.' },
      { status: 409 },
    );
  }

  const { data: leadData } = await supabase.from('leads').select('*').eq('id', input.leadId).maybeSingle();
  const lead = leadData as LeadRow | null;
  let verticalId: string | null = null;
  let verticalName: string | null = null;
  let playbook: Playbook | null = null;
  if (lead?.vertical_slug) {
    const { data: verticalData } = await supabase
      .from('verticals')
      .select('id, name, active_version')
      .eq('slug', lead.vertical_slug)
      .maybeSingle();
    const vertical = verticalData as Pick<VerticalRow, 'id' | 'name' | 'active_version'> | null;
    if (vertical) {
      verticalId = vertical.id;
      verticalName = vertical.name;
      if (vertical.active_version > 0) {
        const { data: versionData } = await supabase
          .from('playbook_versions')
          .select('content')
          .eq('vertical_id', vertical.id)
          .eq('version', vertical.active_version)
          .maybeSingle();
        playbook = (versionData as { content: Playbook } | null)?.content ?? null;
      }
    }
  }

  const extraction = { attempted: false, done: 0, failed: 0 };
  const createdManualTranscript = result.result_code === 'completed' && !input.sessionId && !!result.transcript_id;
  const manualTranscriptAvailable = !input.sessionId && !!result.transcript_id;
  // Re-drive idempotent extraction on an already-completed retry. The call
  // transaction can commit before this route receives a response; skipping
  // retries would leave a permanently unprocessed transcript after a crash.
  if (manualTranscriptAvailable && result.transcript_id && verticalId && isClaudeConfigured()) {
    extraction.attempted = true;
    const processed = await processTranscriptBatch({
      supabase,
      transcriptIds: [result.transcript_id],
      verticalId,
      verticalName: verticalName ?? '',
      matchOutcomes: false,
    });
    extraction.done = processed.done;
    extraction.failed = processed.failed;
  }

  let followups: { generated: boolean; count?: number; reason?: string } = {
    generated: false,
    reason: 'This outcome does not call for a follow-up.',
  };
  let followupPostProcessingComplete = true;
  if (FOLLOWUP_OUTCOMES.includes(input.outcome)) {
    if (!isClaudeConfigured()) {
      followups = { generated: false, reason: 'Claude not configured.' };
    } else if (!lead) {
      followupPostProcessingComplete = false;
      followups = { generated: false, reason: 'Could not reload the lead for follow-up generation.' };
    } else if (!lead.email && !lead.phone) {
      followups = { generated: false, reason: 'Lead has no email or phone to follow up with.' };
    } else {
      try {
        const drafts = await generateFollowups({
          contactName: lead.full_name,
          verticalName,
          outcome: input.outcome,
          notes: input.notes,
          playbook,
        });
        const rows: { call_id: string; kind: 'email' | 'sms'; to_address: string; subject: string | null; body: string }[] = [];
        if (lead.email) rows.push({ call_id: result.call_id, kind: 'email', to_address: lead.email, subject: drafts.email.subject, body: drafts.email.body });
        if (lead.phone) rows.push({ call_id: result.call_id, kind: 'sms', to_address: lead.phone, subject: null, body: drafts.sms });
        if (rows.length > 0) {
          const { error: followupError } = await supabase.from('followups').upsert(rows, {
            onConflict: 'call_id,kind',
            ignoreDuplicates: true,
          });
          if (followupError) throw followupError;
        }
        followups = { generated: true, count: rows.length };
      } catch (caught) {
        followupPostProcessingComplete = false;
        console.error('Generate follow-ups failed:', caught);
        followups = { generated: false, reason: caught instanceof Error ? caught.message : 'Could not generate follow-ups.' };
      }
    }
  }

  return NextResponse.json({
    configured: true,
    saved: true,
    postProcessingComplete: extraction.failed === 0 && followupPostProcessingComplete,
    alreadyCompleted: result.result_code === 'already_completed',
    callId: result.call_id,
    transcript: result.transcript_id
      ? { created: createdManualTranscript, transcriptId: result.transcript_id, extraction }
      : { created: false },
    followups,
  });
}
