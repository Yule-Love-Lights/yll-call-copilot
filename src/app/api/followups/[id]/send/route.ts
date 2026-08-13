// Human-approved, self-owned follow-up send. The database claims one send
// attempt before the external request. Any ambiguous network result becomes
// send_unknown and cannot be retried blindly, preventing duplicate customer
// messages.

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { resolveCurrentHubActor } from '@/lib/auth/resource';
import {
  getContact,
  getOpportunitiesForContact,
  getStageNameMap,
  HighLevelError,
  isHighLevelConfigured,
  sendConversationMessage,
} from '@/lib/ghl/client';
import { isChannelAllowed } from '@/lib/leads/scoring';
import { isFollowupSendingActivated } from '@/lib/leads/followupSending';
import { normalizePhone } from '@/lib/scoreboard/flywheel';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SendClaim = {
  result_code: string;
  followup_id: string | null;
  call_id: string | null;
  kind: 'email' | 'sms' | null;
  to_address: string | null;
  subject: string | null;
  body: string | null;
  ghl_contact_id: string | null;
  send_attempt_id: string | null;
};

const CURRENT_CONTACT_TIMEOUT_MS = 5000;

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Current contact verification timed out.')), CURRENT_CONTACT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function recipientMatchesCurrentContact(
  kind: 'email' | 'sms',
  toAddress: string | null,
  contact: { email?: string; phone?: string },
): boolean {
  if (!toAddress?.trim()) return false;
  if (kind === 'email') {
    return !!contact.email?.trim()
      && contact.email.trim().toLowerCase() === toAddress.trim().toLowerCase();
  }
  const current = normalizePhone(contact.phone);
  return current !== null && current === normalizePhone(toAddress);
}

function isDefiniteProviderFailure(error: unknown): boolean {
  if (!(error instanceof HighLevelError) || typeof error.status !== 'number') return false;
  return error.status >= 400
    && error.status < 500
    && ![408, 409, 425, 429].includes(error.status);
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, sent: false }, { status: 503 });
  }
  if (!isFollowupSendingActivated() || process.env.GHL_FOLLOWUP_SEND_ENABLED !== 'true') {
    return NextResponse.json({ configured: true, sent: false, reason: 'Follow-up sending is not available yet.' });
  }
  if (!isHighLevelConfigured()) {
    return NextResponse.json({ configured: true, sent: false, reason: 'HighLevel not configured.' });
  }
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ configured: true, sent: false, error: 'Follow-up not found.' }, { status: 404 });
  }
  const actorResolution = await resolveCurrentHubActor();
  if (actorResolution.status !== 'resolved') {
    return NextResponse.json(
      { configured: true, sent: false, error: 'Access denied.' },
      { status: actorResolution.status === 'unavailable' ? 503 : 403 },
    );
  }

  const supabase = getSupabaseServerClient()!;
  const sendAttemptId = randomUUID();
  const { data, error } = await supabase.rpc('begin_owned_followup_send', {
    p_actor_employee_id: actorResolution.actor.employeeId,
    p_actor_email: actorResolution.actor.email,
    p_followup_id: id,
    p_send_attempt_id: sendAttemptId,
  });
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, sent: false, migrated: false, reason: 'Run migration 0020 first.' });
    }
    console.error('Claim follow-up send failed:', error);
    return NextResponse.json({ configured: true, sent: false, error: 'Could not send the follow-up.' }, { status: 500 });
  }
  const claim = (Array.isArray(data) ? data[0] : data) as SendClaim | null;
  if (!claim) {
    return NextResponse.json({ configured: true, sent: false, error: 'Could not send the follow-up.' }, { status: 500 });
  }
  if (claim.result_code === 'followup_missing') {
    return NextResponse.json({ configured: true, sent: false, error: 'Follow-up not found.' }, { status: 404 });
  }
  if (claim.result_code === 'actor_inactive' || claim.result_code === 'not_owned_or_incomplete') {
    return NextResponse.json({ configured: true, sent: false, error: 'Access denied.' }, { status: 403 });
  }
  if (claim.result_code === 'approved_sent') {
    return NextResponse.json({ configured: true, sent: true, alreadySent: true });
  }
  if (claim.result_code === 'missing_contact') {
    return NextResponse.json({ configured: true, sent: false, error: 'No GoHighLevel contact linked to this follow-up.' }, { status: 409 });
  }
  if (claim.result_code !== 'ready' || !claim.kind || !claim.body || !claim.ghl_contact_id || claim.send_attempt_id !== sendAttemptId) {
    const reviewRequired = ['sending', 'in_progress', 'send_unknown'].includes(claim.result_code);
    return NextResponse.json(
      {
        configured: true,
        sent: false,
        error: reviewRequired
          ? 'Delivery is already in progress or uncertain. Check GoHighLevel before taking another action.'
          : 'This follow-up cannot be sent.',
        reviewRequired,
      },
      { status: 409 },
    );
  }

  // Claim first so two clicks cannot both pass the external consent check and
  // send. No provider write occurs until the current contact, exact recipient,
  // DND flag, tags, and stages have all been positively revalidated.
  try {
    const [contact, opportunities, stageNames] = await withTimeout(Promise.all([
      getContact(claim.ghl_contact_id),
      getOpportunitiesForContact(claim.ghl_contact_id),
      getStageNameMap(),
    ]));
    const currentStages = opportunities
      .map(opportunity => opportunity.pipelineStageId ? stageNames.get(opportunity.pipelineStageId) : null)
      .filter((stage): stage is string => !!stage);
    const allowed = recipientMatchesCurrentContact(claim.kind, claim.to_address, contact)
      && isChannelAllowed(
        { dnd: contact.dnd, dndSettings: contact.dndSettings, tags: contact.tags ?? [], stageNames: currentStages },
        claim.kind === 'email' ? 'Email' : 'SMS',
      );
    if (!allowed) {
      await supabase.rpc('finish_owned_followup_send', {
        p_actor_employee_id: actorResolution.actor.employeeId,
        p_actor_email: actorResolution.actor.email,
        p_followup_id: id,
        p_send_attempt_id: sendAttemptId,
        p_result: 'definite_failure',
        p_provider_message_id: null,
      });
      return NextResponse.json(
        { configured: true, sent: false, error: 'The current contact or recipient cannot receive this follow-up.' },
        { status: 409 },
      );
    }
  } catch (caught) {
    console.error('Verify current follow-up permission failed:', caught);
    await supabase.rpc('finish_owned_followup_send', {
      p_actor_employee_id: actorResolution.actor.employeeId,
      p_actor_email: actorResolution.actor.email,
      p_followup_id: id,
      p_send_attempt_id: sendAttemptId,
      p_result: 'definite_failure',
      p_provider_message_id: null,
    });
    return NextResponse.json(
      { configured: true, sent: false, error: 'Could not verify the customer\'s current communication permission.' },
      { status: 503 },
    );
  }

  try {
    let providerMessageId: string | null;
    if (claim.kind === 'email') {
      const sent = await sendConversationMessage({
        type: 'Email',
        contactId: claim.ghl_contact_id,
        subject: claim.subject ?? '',
        html: claim.body,
      });
      providerMessageId = sent.messageId;
    } else {
      const sent = await sendConversationMessage({ type: 'SMS', contactId: claim.ghl_contact_id, message: claim.body });
      providerMessageId = sent.messageId;
    }

    if (!providerMessageId) {
      const { error: unknownError } = await supabase.rpc('finish_owned_followup_send', {
        p_actor_employee_id: actorResolution.actor.employeeId,
        p_actor_email: actorResolution.actor.email,
        p_followup_id: id,
        p_send_attempt_id: sendAttemptId,
        p_result: 'unknown',
        p_provider_message_id: null,
      });
      if (unknownError) console.error('Mark provider-id-less follow-up send uncertain failed:', unknownError);
      return NextResponse.json(
        { configured: true, sent: true, reviewRequired: true, warning: 'GoHighLevel accepted the request without a message id. Verify delivery before another action.' },
        { status: 202 },
      );
    }

    const { data: finishData, error: finishError } = await supabase.rpc('finish_owned_followup_send', {
      p_actor_employee_id: actorResolution.actor.employeeId,
      p_actor_email: actorResolution.actor.email,
      p_followup_id: id,
      p_send_attempt_id: sendAttemptId,
      p_result: 'sent',
      p_provider_message_id: providerMessageId,
    });
    const finishCode = ((Array.isArray(finishData) ? finishData[0] : finishData) as { result_code?: string } | null)?.result_code;
    if (finishError || !['finished', 'already_finished'].includes(finishCode ?? '')) {
      console.error('Finalize successful follow-up send failed:', finishError ?? finishCode);
      return NextResponse.json(
        { configured: true, sent: true, reviewRequired: true, warning: 'Message sent, but its Hub status needs review.' },
        { status: 202 },
      );
    }
    return NextResponse.json({ configured: true, sent: true });
  } catch (caught) {
    console.error('Send follow-up via GoHighLevel failed:', caught);
    const definiteFailure = isDefiniteProviderFailure(caught);
    const { error: finishError } = await supabase.rpc('finish_owned_followup_send', {
      p_actor_employee_id: actorResolution.actor.employeeId,
      p_actor_email: actorResolution.actor.email,
      p_followup_id: id,
      p_send_attempt_id: sendAttemptId,
      p_result: definiteFailure ? 'definite_failure' : 'unknown',
      p_provider_message_id: null,
    });
    if (finishError) console.error('Mark ambiguous follow-up send failed:', finishError);
    return NextResponse.json(
      {
        configured: true,
        sent: false,
        reviewRequired: !definiteFailure,
        error: definiteFailure
          ? 'GoHighLevel rejected the message. You can correct the draft and try again.'
          : 'Delivery could not be confirmed. Check GoHighLevel before trying anything else.',
      },
      { status: 502 },
    );
  }
}
