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

  return NextResponse.json({
    configured: true,
    migrated: true,
    sendEnabled: process.env.GHL_SEND_ENABLED === 'true',
    cookiesOrnamentWindowActive: isWithinCookiesOrnamentWindow(new Date()),
    touches: touches.map(t => ({
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
