// POST /api/second-mile/[id]/draft — generates the message for a sendable
// touch (reveal_photo -> crew, cold_snap_checkin -> customer) via the plain
// template functions in src/lib/secondMile/drafts.ts, no Claude call. Saves
// the draft body onto the touch's payload so a reload still shows it and so
// POST /api/second-mile/[id]/send has something to send without
// regenerating it.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { draftColdSnapCheckinMessage, draftRevealPhotoCrewMessage } from '@/lib/secondMile/drafts';
import { SENDABLE_TOUCH_KINDS, type SecondMileTouchRow } from '@/lib/secondMile/types';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, drafted: false });
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient()!;

  const { data: touchData, error: touchError } = await supabase
    .from('second_mile_touches')
    .select('id, kind, status, customer_name, payload')
    .eq('id', id)
    .maybeSingle();
  if (touchError) {
    if (isMissingTableError(touchError)) {
      return NextResponse.json({ configured: true, drafted: false, reason: 'Run migration 0013 first.' });
    }
    console.error('Load second-mile touch for draft failed:', touchError);
    return NextResponse.json({ configured: true, drafted: false, error: 'Could not load this touch.' }, { status: 500 });
  }
  if (!touchData) {
    return NextResponse.json({ configured: true, drafted: false, error: 'Touch not found.' }, { status: 404 });
  }
  const touch = touchData as Pick<SecondMileTouchRow, 'id' | 'kind' | 'status' | 'customer_name' | 'payload'>;

  if (!(SENDABLE_TOUCH_KINDS as string[]).includes(touch.kind)) {
    return NextResponse.json(
      { configured: true, drafted: false, error: `A "${touch.kind}" touch has no draftable message.` },
      { status: 400 },
    );
  }
  if (touch.status !== 'pending') {
    return NextResponse.json({ configured: true, drafted: false, reason: 'This touch is no longer pending.' }, { status: 409 });
  }

  const payload = touch.payload ?? {};
  const body =
    touch.kind === 'reveal_photo'
      ? draftRevealPhotoCrewMessage({ address: (payload.address as string | null) ?? null, customerName: touch.customer_name })
      : draftColdSnapCheckinMessage({ customerName: touch.customer_name });

  const { error: updateError } = await supabase
    .from('second_mile_touches')
    .update({ payload: { ...payload, draftBody: body } })
    .eq('id', id);
  if (updateError) {
    console.error('Save second-mile draft failed:', updateError);
    return NextResponse.json({ configured: true, drafted: false, error: 'Could not save the draft.' }, { status: 500 });
  }

  return NextResponse.json({ configured: true, drafted: true, body });
}
