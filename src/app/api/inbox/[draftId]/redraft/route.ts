// POST /api/inbox/[draftId]/redraft — a rep isn't happy with the auto-draft
// and wants a fresh one regenerated. Supersedes the current draft (marks it
// 'dismissed' if it is still a 'draft' -- a 'sent'/'failed' one is history
// and is left alone) and generates a brand new one via the same
// draftForInboundEmail() pipeline the webhook and /api/inbox/check use, so
// GET /api/inbox (which always shows the newest draft per inbound email)
// picks up the regenerated reply automatically.
//
// draftForInboundEmail claims the inbound_emails row with a status
// 'new' -> 'drafted' conditional update (src/lib/email/ingest.ts) so a
// concurrent /api/inbox/check retry sweep can't double-draft it. A redraft
// target is normally already 'drafted' (the first draft succeeded), so this
// route resets it to 'new' first to hand the claim back before requesting a
// new one -- draftForInboundEmail owns the status from there (including
// reverting to 'new' again on a Claude/validation failure), so this route no
// longer needs its own separate revert-on-failure step.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { draftForInboundEmail } from '@/lib/email/ingest';
import type { EmailReplyDraftRow, InboundEmailRow } from '@/lib/email/types';

export async function POST(_request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, redrafted: false });
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
      return NextResponse.json({ configured: true, redrafted: false, reason: 'Run migration 0012 first.' });
    }
    console.error('Load email reply draft for redraft failed:', draftError);
    return NextResponse.json({ configured: true, redrafted: false, error: 'Could not load the draft.' }, { status: 500 });
  }
  if (!draftData) {
    return NextResponse.json({ configured: true, redrafted: false, error: 'Draft not found.' }, { status: 404 });
  }
  const draft = draftData as Pick<EmailReplyDraftRow, 'id' | 'inbound_email_id' | 'status'>;

  if (draft.status === 'draft') {
    const { error: supersedeError } = await supabase.from('email_reply_drafts').update({ status: 'dismissed' }).eq('id', draftId);
    if (supersedeError) console.error('Supersede prior draft on redraft failed:', supersedeError);
  }

  const { data: inboundEmailData, error: inboundEmailError } = await supabase
    .from('inbound_emails')
    .select('id, subject, body, from_name')
    .eq('id', draft.inbound_email_id)
    .maybeSingle();
  if (inboundEmailError || !inboundEmailData) {
    console.error('Load inbound email for redraft failed:', inboundEmailError);
    return NextResponse.json({ configured: true, redrafted: false, error: 'Could not load the original email.' }, { status: 500 });
  }
  const inboundEmail = inboundEmailData as Pick<InboundEmailRow, 'id' | 'subject' | 'body' | 'from_name'>;

  const { error: resetError } = await supabase.from('inbound_emails').update({ status: 'new' }).eq('id', inboundEmail.id);
  if (resetError) console.error('Reset inbound email to new before redraft failed:', resetError);

  const result = await draftForInboundEmail(supabase, inboundEmail);
  if (!result.ok) {
    // draftForInboundEmail already reverts the row to 'new' on a claim or
    // Claude/validation failure -- the retry sweep in POST /api/inbox/check
    // or a second manual redraft can recover it from there.
    return NextResponse.json({ configured: true, redrafted: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({ configured: true, redrafted: true });
}
