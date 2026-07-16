// POST /api/inbox/[draftId]/send — sends an approved email reply draft via
// GHL's conversations API. Clones POST /api/followups/[id]/send's shape
// exactly: every send is a human click on this endpoint (nothing here
// auto-sends), gated behind GHL_SEND_ENABLED so a review/staging
// environment can never message a real customer by accident -- default is
// OFF (unset or anything other than 'true' disables it), and a conditional
// claim-before-send update means two rapid clicks can't double-send.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { HighLevelError, isHighLevelConfigured } from '@/lib/ghl/client';
import { sendEmailReply } from '@/lib/ghl/email';
import type { EmailReplyDraftRow, InboundEmailRow } from '@/lib/email/types';

export async function POST(_request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, sent: false });
  }
  if (process.env.GHL_SEND_ENABLED !== 'true') {
    return NextResponse.json({ configured: true, sent: false, reason: 'Sending disabled - set GHL_SEND_ENABLED=true' });
  }

  const { draftId } = await params;
  const supabase = getSupabaseServerClient()!;

  const { data: draftData, error: draftError } = await supabase
    .from('email_reply_drafts')
    .select('id, inbound_email_id, subject, body, status')
    .eq('id', draftId)
    .maybeSingle();
  if (draftError) {
    if (isMissingTableError(draftError)) {
      return NextResponse.json({ configured: true, sent: false, reason: 'Run migration 0012 first.' });
    }
    console.error('Load email reply draft for send failed:', draftError);
    return NextResponse.json({ configured: true, sent: false, error: 'Could not load the draft.' }, { status: 500 });
  }
  if (!draftData) {
    return NextResponse.json({ configured: true, sent: false, error: 'Draft not found.' }, { status: 404 });
  }
  const draft = draftData as Pick<EmailReplyDraftRow, 'id' | 'inbound_email_id' | 'subject' | 'body' | 'status'>;

  if (draft.status !== 'draft') {
    return NextResponse.json(
      { configured: true, sent: false, error: 'This reply was already sent, failed, or dismissed.' },
      { status: 409 },
    );
  }
  if (!isHighLevelConfigured()) {
    return NextResponse.json({ configured: true, sent: false, reason: 'HighLevel not configured.' });
  }

  const { data: inboundEmailData } = await supabase
    .from('inbound_emails')
    .select('ghl_contact_id, ghl_conversation_id')
    .eq('id', draft.inbound_email_id)
    .maybeSingle();
  const inboundEmail = inboundEmailData as Pick<InboundEmailRow, 'ghl_contact_id' | 'ghl_conversation_id'> | null;
  const contactId = inboundEmail?.ghl_contact_id ?? null;
  if (!contactId) {
    return NextResponse.json(
      { configured: true, sent: false, error: 'No GoHighLevel contact linked to this email.' },
      { status: 409 },
    );
  }

  // Claim the draft BEFORE calling GHL -- a conditional update on
  // status='draft' means two rapid clicks can't both pass the status check
  // above and message the customer twice. If the GHL call then fails, the
  // catch flips the row to 'failed', so an optimistic 'sent' only ever
  // survives a send that actually went through.
  const { data: claimedRows, error: claimError } = await supabase
    .from('email_reply_drafts')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', draftId)
    .eq('status', 'draft')
    .select('id');
  if (claimError) {
    console.error('Claim email reply draft for send failed:', claimError);
    return NextResponse.json({ configured: true, sent: false, error: 'Could not send the reply.' }, { status: 500 });
  }
  if (!claimedRows || claimedRows.length === 0) {
    return NextResponse.json(
      { configured: true, sent: false, error: 'This reply was already sent, failed, or dismissed.' },
      { status: 409 },
    );
  }

  try {
    await sendEmailReply({
      contactId,
      conversationId: inboundEmail?.ghl_conversation_id ?? null,
      subject: draft.subject,
      html: draft.body,
    });

    const { error: inboundUpdateError } = await supabase
      .from('inbound_emails')
      .update({ status: 'sent' })
      .eq('id', draft.inbound_email_id);
    if (inboundUpdateError) console.error('Mark inbound email sent-status failed:', inboundUpdateError);

    const { error: logError } = await supabase.from('events_log').insert({
      kind: 'email_reply_sent',
      detail: { draftId, inboundEmailId: draft.inbound_email_id, contactId },
    });
    if (logError) console.error('Log email reply sent event failed:', logError);

    return NextResponse.json({ configured: true, sent: true });
  } catch (err) {
    console.error('Send email reply via GHL failed:', err);
    const { error: failError } = await supabase.from('email_reply_drafts').update({ status: 'failed' }).eq('id', draftId);
    if (failError) console.error('Mark email reply draft failed-status failed:', failError);

    const message = err instanceof HighLevelError ? err.message : 'Could not send via GoHighLevel.';
    return NextResponse.json({ configured: true, sent: false, error: message }, { status: 502 });
  }
}
