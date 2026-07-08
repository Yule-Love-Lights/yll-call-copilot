// POST /api/calls — saves a call from the console (/call/[leadId]): body
// {leadId, outcome, notes, transcript?, callId?}. Sequential inserts, each
// error surfaced rather than swallowed:
//   1. transcript row (only if transcript text was pasted AND this is not a
//      live-coached call — see step 2), then the existing extraction
//      pipeline (src/lib/transcripts/process.ts) against it — reused rather
//      than re-implemented, per the brief.
//   2. the calls row itself. callId absent -> insert a fresh row, linking
//      the transcript if any (a plain outbound call logged straight from
//      the console). callId present -> UPDATE that existing row instead:
//      POST /api/live/end already created it (transcript_id, lead_id,
//      ghl_contact_id already set from the live session) and handed the id
//      back to the console via the ?callId= query param, so tagging the
//      outcome here would otherwise insert a SECOND calls row for the same
//      conversation. Updating also means no new transcript is created for
//      this request (step 1) — the live session already stored and
//      extracted one.
//   3. the lead's status -> done.
//   4. for an interested/callback/voicemail outcome, a best-effort
//      follow-up draft generation (src/lib/leads/followups.ts) — Claude not
//      configured, or generation failing, degrades to {generated:false} and
//      does not fail the whole request; the call itself already saved.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { isClaudeConfigured } from '@/lib/claude';
import { getSessionEmail } from '@/lib/auth/session';
import { validateCallInput } from '@/lib/leads/calls';
import { generateFollowups } from '@/lib/leads/followups';
import { FOLLOWUP_OUTCOMES, type LeadRow } from '@/lib/leads/types';
import { processTranscriptBatch } from '@/lib/transcripts/process';
import type { Playbook, VerticalRow } from '@/lib/playbook/types';

export const maxDuration = 120;

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' });
  }

  const body = await request.json().catch(() => null);
  const validation = validateCallInput(body);
  if (!validation.valid) {
    return NextResponse.json({ configured: true, saved: false, error: validation.error }, { status: 400 });
  }
  const input = validation.input;

  const supabase = getSupabaseServerClient()!;

  const { data: leadData, error: leadError } = await supabase.from('leads').select('*').eq('id', input.leadId).maybeSingle();
  if (leadError) {
    if (isMissingTableError(leadError)) {
      return NextResponse.json({ configured: true, saved: false, migrated: false, reason: 'Run migration 0004 first.' });
    }
    console.error('Load lead for call save failed:', leadError);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not load the lead.' }, { status: 500 });
  }
  if (!leadData) {
    return NextResponse.json({ configured: true, saved: false, error: 'Lead not found.' }, { status: 404 });
  }
  const lead = leadData as LeadRow;

  // Resolve the matched vertical (best-effort) for extraction + follow-up
  // grounding. A lead with no vertical_slug match (e.g. a fresh inbound-
  // webhook lead) just skips both rather than failing the save.
  let verticalId: string | null = null;
  let verticalName: string | null = null;
  let playbook: Playbook | null = null;
  if (lead.vertical_slug) {
    const { data: verticalData } = await supabase
      .from('verticals')
      .select('id, name, active_version')
      .eq('slug', lead.vertical_slug)
      .maybeSingle();
    if (verticalData) {
      const v = verticalData as Pick<VerticalRow, 'id' | 'name' | 'active_version'>;
      verticalId = v.id;
      verticalName = v.name;
      if (v.active_version > 0) {
        const { data: versionData } = await supabase
          .from('playbook_versions')
          .select('content')
          .eq('vertical_id', v.id)
          .eq('version', v.active_version)
          .maybeSingle();
        playbook = (versionData as { content: Playbook } | null)?.content ?? null;
      }
    }
  }

  // 1. Transcript + extraction (optional) — skipped for a live-coached call
  // (input.callId set). Its transcript was already stored and extracted by
  // POST /api/live/end; doing it again here would create a duplicate.
  let transcriptId: string | null = null;
  const extraction: { attempted: boolean; done: number; failed: number } = { attempted: false, done: 0, failed: 0 };
  if (!input.callId && input.transcript) {
    const { data: transcriptData, error: transcriptError } = await supabase
      .from('transcripts')
      .insert({
        vertical_id: verticalId,
        customer_name: lead.full_name,
        customer_phone: lead.phone,
        called_at: new Date().toISOString(),
        raw_text: input.transcript,
      })
      .select('id')
      .single();
    if (transcriptError) {
      console.error('Insert transcript for call failed:', transcriptError);
      return NextResponse.json({ configured: true, saved: false, error: 'Could not store the transcript.' }, { status: 500 });
    }
    transcriptId = (transcriptData as { id: string }).id;

    if (isClaudeConfigured() && verticalId) {
      extraction.attempted = true;
      const result = await processTranscriptBatch({
        supabase,
        transcriptIds: [transcriptId],
        verticalId,
        verticalName: verticalName ?? '',
        // The outcome is already known from this call — no need to spend a
        // GHL round trip re-deriving it the way bulk ingest does.
        matchOutcomes: false,
      });
      extraction.done = result.done;
      extraction.failed = result.failed;
    }
  }

  // 2. The call itself — update the live session's row if we have its id,
  // otherwise insert a fresh one (see the file-header comment).
  const rep_email = await getSessionEmail();
  let callId: string;
  if (input.callId) {
    const { data: existingCallData, error: existingCallError } = await supabase
      .from('calls')
      .select('id')
      .eq('id', input.callId)
      .maybeSingle();
    if (existingCallError) {
      console.error('Load existing call for update failed:', existingCallError);
      return NextResponse.json({ configured: true, saved: false, error: 'Could not load the call.' }, { status: 500 });
    }
    if (!existingCallData) {
      return NextResponse.json({ configured: true, saved: false, error: 'Call not found.' }, { status: 404 });
    }

    const { error: updateError } = await supabase
      .from('calls')
      .update({
        rep_email,
        outcome: input.outcome,
        notes: input.notes,
        ended_at: new Date().toISOString(),
      })
      .eq('id', input.callId);
    if (updateError) {
      console.error('Update call failed:', updateError);
      return NextResponse.json({ configured: true, saved: false, error: 'Could not save the call.' }, { status: 500 });
    }
    callId = input.callId;
  } else {
    const { data: callData, error: callError } = await supabase
      .from('calls')
      .insert({
        lead_id: lead.id,
        ghl_contact_id: lead.ghl_contact_id,
        rep_email,
        direction: input.direction,
        outcome: input.outcome,
        notes: input.notes,
        transcript_id: transcriptId,
        ended_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (callError) {
      console.error('Insert call failed:', callError);
      return NextResponse.json({ configured: true, saved: false, error: 'Could not save the call.' }, { status: 500 });
    }
    callId = (callData as { id: string }).id;
  }

  // 3. Lead -> done. Non-fatal if it fails: the call already saved, and a
  // rep can still see/finish it from the console.
  const { error: leadUpdateError } = await supabase
    .from('leads')
    .update({ status: 'done', done_at: new Date().toISOString() })
    .eq('id', lead.id);
  if (leadUpdateError) {
    console.error('Mark lead done failed:', leadUpdateError);
  }

  // 4. Follow-up drafts (best-effort, only for outcomes that warrant one).
  let followupsResult: { generated: boolean; count?: number; reason?: string } = {
    generated: false,
    reason: 'This outcome does not call for a follow-up.',
  };
  if ((FOLLOWUP_OUTCOMES as string[]).includes(input.outcome)) {
    if (!isClaudeConfigured()) {
      followupsResult = { generated: false, reason: 'Claude not configured.' };
    } else if (!lead.email && !lead.phone) {
      followupsResult = { generated: false, reason: 'Lead has no email or phone to follow up with.' };
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
        if (lead.email) rows.push({ call_id: callId, kind: 'email', to_address: lead.email, subject: drafts.email.subject, body: drafts.email.body });
        if (lead.phone) rows.push({ call_id: callId, kind: 'sms', to_address: lead.phone, subject: null, body: drafts.sms });

        if (rows.length > 0) {
          const { error: followupError } = await supabase.from('followups').insert(rows);
          if (followupError) throw followupError;
        }
        followupsResult = { generated: true, count: rows.length };
      } catch (err) {
        console.error('Generate follow-ups failed:', err);
        followupsResult = { generated: false, reason: err instanceof Error ? err.message : 'Could not generate follow-ups.' };
      }
    }
  }

  return NextResponse.json({
    configured: true,
    saved: true,
    callId,
    transcript: transcriptId ? { created: true, transcriptId, extraction } : { created: false },
    followups: followupsResult,
  });
}
