// GET /api/second-mile — everything the /second-mile queue page needs in
// one request: every touch (a rep works the whole list from one page, no
// pagination needed at this scale), whether GHL sending is turned on (so
// the client can disable Send with a reason instead of discovering the gate
// closed after a failed click, same convention as GET /api/leads/[id]), and
// whether the December 10-25 cookies+ornament window is active right now
// (drives the page's banner).

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { isWithinCookiesOrnamentWindow } from '@/lib/secondMile/decemberWindow';
import type { SecondMileTouchRow } from '@/lib/secondMile/types';

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function personalTouchTranscriptId(touch: SecondMileTouchRow): string | null {
  if (touch.kind !== 'personal_touch') return null;
  const transcriptId = touch.payload?.transcript_id;
  return typeof transcriptId === 'string' && UUID_TEXT.test(transcriptId)
    ? transcriptId
    : null;
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, touches: [] });
  }

  const supabase = getSupabaseServerClient()!;
  const { data, error } = await supabase
    .from('second_mile_touches')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0013 first.', touches: [] });
    }
    console.error('Load second-mile touches failed:', error);
    return NextResponse.json({ configured: true, error: 'Could not load the second-mile queue.', touches: [] }, { status: 500 });
  }
  const touches = (data ?? []) as SecondMileTouchRow[];
  const personalTouchTranscriptIds = [
    ...new Set(
      touches
        .map(personalTouchTranscriptId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const performanceTranscriptIds = new Set<string>();

  if (personalTouchTranscriptIds.length > 0) {
    const { data: provenanceRows, error: provenanceError } = await supabase
      .from('transcripts')
      .select('id')
      .in('id', personalTouchTranscriptIds)
      .eq('metric_scope', 'performance');
    if (provenanceError) {
      console.error('Load second-mile transcript provenance failed:', provenanceError);
      return NextResponse.json(
        { configured: true, error: 'Could not verify the second-mile queue.', touches: [] },
        { status: 500 },
      );
    }
    for (const row of provenanceRows ?? []) {
      performanceTranscriptIds.add((row as { id: string }).id);
    }
  }

  const eligibleTouches = touches.filter(touch => {
    if (touch.kind !== 'personal_touch') return true;
    const transcriptId = personalTouchTranscriptId(touch);
    return transcriptId !== null && performanceTranscriptIds.has(transcriptId);
  });

  return NextResponse.json({
    configured: true,
    migrated: true,
    sendEnabled: process.env.GHL_SEND_ENABLED === 'true',
    cookiesOrnamentWindowActive: isWithinCookiesOrnamentWindow(new Date()),
    touches: eligibleTouches.map(t => ({
      id: t.id,
      ghlContactId: t.ghl_contact_id,
      customerName: t.customer_name,
      kind: t.kind,
      status: t.status,
      dueAt: t.due_at,
      payload: t.payload,
      createdAt: t.created_at,
      doneAt: t.done_at,
      doneBy: t.done_by,
    })),
  });
}
