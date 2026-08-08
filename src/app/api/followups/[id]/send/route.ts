// POST /api/followups/[id]/send — sends an approved draft via GHL's
// conversations API. Every send is a human click on this endpoint; there is
// no auto-send path anywhere in this wave. Gated behind GHL_SEND_ENABLED so
// a review/staging environment can never message a real customer by
// accident — default is OFF (unset or anything other than 'true' disables
// it), matching the console's disabled-button default.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { authorizeCallResource, resolveCurrentHubActor } from '@/lib/auth/resource';
import { HighLevelError, isHighLevelConfigured, sendConversationMessage } from '@/lib/ghl/client';
import type { CallRow, FollowupRow, LeadRow } from '@/lib/leads/types';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, sent: false });
  }
  if (process.env.GHL_SEND_ENABLED !== 'true') {
    return NextResponse.json({ configured: true, sent: false, reason: 'Sending disabled - set GHL_SEND_ENABLED=true' });
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient()!;
  const actorResolution = await resolveCurrentHubActor();
  if (actorResolution.status !== 'resolved') {
    return NextResponse.json(
      { configured: true, sent: false, error: 'Access denied.' },
      { status: actorResolution.status === 'unavailable' ? 503 : 403 },
    );
  }

  const { data: followupData, error: followupError } = await supabase
    .from('followups')
    .select('id, call_id, kind, to_address, subject, body, status')
    .eq('id', id)
    .maybeSingle();
  if (followupError) {
    if (isMissingTableError(followupError)) {
      return NextResponse.json({ configured: true, sent: false, reason: 'Run migration 0004 first.' });
    }
    console.error('Load followup for send failed:', followupError);
    return NextResponse.json({ configured: true, sent: false, error: 'Could not load the follow-up.' }, { status: 500 });
  }
  if (!followupData) {
    return NextResponse.json({ configured: true, sent: false, error: 'Follow-up not found.' }, { status: 404 });
  }
  const followup = followupData as FollowupRow;

  if (!followup.call_id) {
    return NextResponse.json(
      { configured: true, sent: false, error: 'Access denied.' },
      { status: 403 },
    );
  }
  const authorization = await authorizeCallResource(supabase, {
    actor: actorResolution.actor,
    callId: followup.call_id,
    action: 'followup.send',
    resourceType: 'followup',
    resourceId: id,
    teamCapability: 'operations.admin',
  });
  if (authorization.status !== 'authorized') {
    const status = authorization.status === 'unavailable' ? 503
      : authorization.status === 'missing' ? 404 : 403;
    return NextResponse.json(
      { configured: true, sent: false, error: 'Access denied.' },
      { status },
    );
  }

  if (followup.status !== 'draft') {
    return NextResponse.json(
      { configured: true, sent: false, error: 'This follow-up was already sent or failed.' },
      { status: 409 },
    );
  }
  if (!isHighLevelConfigured()) {
    return NextResponse.json({ configured: true, sent: false, reason: 'HighLevel not configured.' });
  }

  // Walk followup -> call -> lead to find the GHL contact to send to.
  let contactId: string | null = null;
  if (followup.call_id) {
    const { data: callData } = await supabase
      .from('calls')
      .select('ghl_contact_id, lead_id')
      .eq('id', followup.call_id)
      .maybeSingle();
    const call = callData as Pick<CallRow, 'ghl_contact_id' | 'lead_id'> | null;
    contactId = call?.ghl_contact_id ?? null;
    if (!contactId && call?.lead_id) {
      const { data: leadData } = await supabase.from('leads').select('ghl_contact_id').eq('id', call.lead_id).maybeSingle();
      contactId = (leadData as Pick<LeadRow, 'ghl_contact_id'> | null)?.ghl_contact_id ?? null;
    }
  }
  if (!contactId) {
    return NextResponse.json(
      { configured: true, sent: false, error: 'No GoHighLevel contact linked to this follow-up.' },
      { status: 409 },
    );
  }

  // Claim the draft BEFORE calling GHL: a conditional update on
  // status='draft' means two rapid clicks can't both pass the status check
  // above and message the customer twice — the second click matches zero
  // rows here and stops. If the GHL call then fails, the catch flips the
  // row to 'failed', so the optimistic 'approved_sent' only ever survives a
  // send that actually went through.
  const { data: claimedRows, error: claimError } = await supabase
    .from('followups')
    .update({ status: 'approved_sent', sent_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'draft')
    .select('id');
  if (claimError) {
    console.error('Claim followup for send failed:', claimError);
    return NextResponse.json({ configured: true, sent: false, error: 'Could not send the follow-up.' }, { status: 500 });
  }
  if (!claimedRows || claimedRows.length === 0) {
    return NextResponse.json(
      { configured: true, sent: false, error: 'This follow-up was already sent or failed.' },
      { status: 409 },
    );
  }

  try {
    if (followup.kind === 'email') {
      await sendConversationMessage({ type: 'Email', contactId, subject: followup.subject ?? '', html: followup.body });
    } else {
      await sendConversationMessage({ type: 'SMS', contactId, message: followup.body });
    }

    return NextResponse.json({ configured: true, sent: true });
  } catch (err) {
    console.error('Send followup via GHL failed:', err);
    const { error: failError } = await supabase.from('followups').update({ status: 'failed' }).eq('id', id);
    if (failError) console.error('Mark followup failed-status failed:', failError);

    const message = err instanceof HighLevelError ? err.message : 'Could not send via GoHighLevel.';
    return NextResponse.json({ configured: true, sent: false, error: message }, { status: 502 });
  }
}
