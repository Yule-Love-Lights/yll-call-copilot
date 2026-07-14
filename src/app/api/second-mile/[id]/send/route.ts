// POST /api/second-mile/[id]/send — sends a sendable touch's drafted
// message via GHL SMS. Follows POST /api/followups/[id]/send's pattern
// exactly: GHL_SEND_ENABLED gate, a human click is the only trigger (never
// auto-sent), and a claim-before-send compare-and-swap so two rapid clicks
// can't double-send.
//
// One deviation from that route, noted here since it's the load-bearing
// difference: second_mile_touches has no 'failed' status (its check
// constraint is pending/done/skipped only, see 0013_second_mile.sql) — a
// failed GHL send reverts the claimed row back to 'pending' instead of a
// terminal 'failed', so a rep can just click Send again rather than the
// touch getting stuck.
//
// reveal_photo sends to the CREW (SECOND_MILE_CREW_PHONE, resolved to GHL
// contact ids by src/lib/ghl/secondMile.ts) since the message is an
// instruction to the crew, not the customer; cold_snap_checkin sends to the
// touch's own ghl_contact_id (the customer).

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import { HighLevelError, isHighLevelConfigured, sendConversationMessage } from '@/lib/ghl/client';
import { resolveCrewContactIds } from '@/lib/ghl/secondMile';
import { draftColdSnapCheckinMessage, draftRevealPhotoCrewMessage } from '@/lib/secondMile/drafts';
import { SENDABLE_TOUCH_KINDS, type SecondMileTouchRow } from '@/lib/secondMile/types';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, sent: false });
  }
  if (process.env.GHL_SEND_ENABLED !== 'true') {
    return NextResponse.json({ configured: true, sent: false, reason: 'Sending disabled - set GHL_SEND_ENABLED=true' });
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient()!;

  const { data: touchData, error: touchError } = await supabase
    .from('second_mile_touches')
    .select('id, ghl_contact_id, customer_name, kind, status, payload')
    .eq('id', id)
    .maybeSingle();
  if (touchError) {
    if (isMissingTableError(touchError)) {
      return NextResponse.json({ configured: true, sent: false, reason: 'Run migration 0013 first.' });
    }
    console.error('Load second-mile touch for send failed:', touchError);
    return NextResponse.json({ configured: true, sent: false, error: 'Could not load this touch.' }, { status: 500 });
  }
  if (!touchData) {
    return NextResponse.json({ configured: true, sent: false, error: 'Touch not found.' }, { status: 404 });
  }
  const touch = touchData as Pick<SecondMileTouchRow, 'id' | 'ghl_contact_id' | 'customer_name' | 'kind' | 'status' | 'payload'>;

  if (!(SENDABLE_TOUCH_KINDS as string[]).includes(touch.kind)) {
    return NextResponse.json({ configured: true, sent: false, error: `A "${touch.kind}" touch cannot be sent.` }, { status: 400 });
  }
  if (touch.status !== 'pending') {
    return NextResponse.json({ configured: true, sent: false, error: 'This touch is no longer pending.' }, { status: 409 });
  }
  if (!isHighLevelConfigured()) {
    return NextResponse.json({ configured: true, sent: false, reason: 'HighLevel not configured.' });
  }

  const payload = touch.payload ?? {};
  const draftBody =
    (payload.draftBody as string | undefined) ??
    (touch.kind === 'reveal_photo'
      ? draftRevealPhotoCrewMessage({ address: (payload.address as string | null) ?? null, customerName: touch.customer_name })
      : draftColdSnapCheckinMessage({ customerName: touch.customer_name }));

  let targetContactIds: string[];
  if (touch.kind === 'cold_snap_checkin') {
    if (!touch.ghl_contact_id) {
      return NextResponse.json({ configured: true, sent: false, error: 'No GoHighLevel contact linked to this touch.' }, { status: 409 });
    }
    targetContactIds = [touch.ghl_contact_id];
  } else {
    targetContactIds = await resolveCrewContactIds(process.env.SECOND_MILE_CREW_PHONE);
    if (targetContactIds.length === 0) {
      return NextResponse.json({
        configured: true,
        sent: false,
        reason: 'No crew contacts configured - set SECOND_MILE_CREW_PHONE.',
      });
    }
  }

  // Claim the row BEFORE calling GHL — same compare-and-swap as the
  // followups send route, for the same reason: two rapid clicks can't both
  // pass the pending check above and message the customer/crew twice.
  const doneBy = await getSessionEmail();
  const { data: claimedRows, error: claimError } = await supabase
    .from('second_mile_touches')
    .update({ status: 'done', done_at: new Date().toISOString(), done_by: doneBy })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (claimError) {
    console.error('Claim second-mile touch for send failed:', claimError);
    return NextResponse.json({ configured: true, sent: false, error: 'Could not send this touch.' }, { status: 500 });
  }
  if (!claimedRows || claimedRows.length === 0) {
    return NextResponse.json({ configured: true, sent: false, error: 'This touch is no longer pending.' }, { status: 409 });
  }

  try {
    for (const contactId of targetContactIds) {
      await sendConversationMessage({ type: 'SMS', contactId, message: draftBody });
    }
    return NextResponse.json({ configured: true, sent: true });
  } catch (err) {
    console.error('Send second-mile touch via GHL failed:', err);
    // No 'failed' status in this table's check constraint (unlike
    // followups) — revert to 'pending' so the rep can just try Send again.
    const { error: revertError } = await supabase.from('second_mile_touches').update({ status: 'pending', done_at: null, done_by: null }).eq('id', id);
    if (revertError) console.error('Revert second-mile touch to pending after failed send failed:', revertError);

    const message = err instanceof HighLevelError ? err.message : 'Could not send via GoHighLevel.';
    return NextResponse.json({ configured: true, sent: false, error: message }, { status: 502 });
  }
}
