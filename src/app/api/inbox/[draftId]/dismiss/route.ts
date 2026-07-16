// POST /api/inbox/[draftId]/dismiss — a rep decides this email needs no
// reply (spam, already handled by phone, etc). Only a 'draft' row can be
// dismissed -- once sent or failed, the record is history. Also flips the
// parent inbound_emails row to 'dismissed' so it drops out of the "needs
// attention" view, same status-mirroring the send route does the other way
// (marks the inbound email 'sent' alongside the draft).

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import type { EmailReplyDraftRow } from '@/lib/email/types';

export async function POST(_request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, dismissed: false });
  }

  const { draftId } = await params;
  const supabase = getSupabaseServerClient()!;

  const { data: draftData, error: draftError } = await supabase
    .from('email_reply_drafts')
    .select('id, inbound_email_id, status')
    .eq('id', draftId)
    .maybeSingle();
  if (draftError) {
    if (isMissingTableError(draftError)) {
      return NextResponse.json({ configured: true, dismissed: false, reason: 'Run migration 0012 first.' });
    }
    console.error('Load email reply draft for dismiss failed:', draftError);
    return NextResponse.json({ configured: true, dismissed: false, error: 'Could not load the draft.' }, { status: 500 });
  }
  if (!draftData) {
    return NextResponse.json({ configured: true, dismissed: false, error: 'Draft not found.' }, { status: 404 });
  }
  const draft = draftData as Pick<EmailReplyDraftRow, 'id' | 'inbound_email_id' | 'status'>;

  if (draft.status !== 'draft') {
    return NextResponse.json(
      { configured: true, dismissed: false, error: 'This reply was already sent, failed, or dismissed.' },
      { status: 409 },
    );
  }

  const { error: updateError } = await supabase.from('email_reply_drafts').update({ status: 'dismissed' }).eq('id', draftId);
  if (updateError) {
    console.error('Dismiss email reply draft failed:', updateError);
    return NextResponse.json({ configured: true, dismissed: false, error: 'Could not dismiss the draft.' }, { status: 500 });
  }

  const { error: inboundUpdateError } = await supabase
    .from('inbound_emails')
    .update({ status: 'dismissed' })
    .eq('id', draft.inbound_email_id);
  if (inboundUpdateError) console.error('Mark inbound email dismissed-status failed:', inboundUpdateError);

  return NextResponse.json({ configured: true, dismissed: true });
}
