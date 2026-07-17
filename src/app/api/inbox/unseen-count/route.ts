// GET /api/inbox/unseen-count — count of inbound_emails still needing
// attention (status 'new' or 'drafted'), for the nav's gold badge on
// "Inbox" (CoachNav.tsx fetches this once on mount, no polling). The inbox
// has no per-rep ownership (see GET /api/inbox), so any signed-in staff
// member sees the same number — this only needs a session, not a role
// check.
//
// Same "always degrade, never throw a banner" convention as
// GET /api/feedback/unseen-count and GET /api/dashboard/summary.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ count: 0 });
  }

  const repEmail = await getSessionEmail();
  if (!repEmail) {
    return NextResponse.json({ count: 0 });
  }

  const supabase = getSupabaseServerClient()!;
  const { count, error } = await supabase
    .from('inbound_emails')
    .select('id', { count: 'exact', head: true })
    .in('status', ['new', 'drafted']);
  if (error) {
    if (!isMissingTableError(error)) {
      console.error('Load unseen inbox count failed:', error);
    }
    return NextResponse.json({ count: 0 });
  }

  return NextResponse.json({ count: count ?? 0 });
}
