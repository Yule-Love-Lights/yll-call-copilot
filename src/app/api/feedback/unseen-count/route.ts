// GET /api/feedback/unseen-count — the signed-in rep's own unread coaching
// card count, for the nav's gold badge on "My cards" (CoachNav.tsx fetches
// this once on mount, no polling). Count only: this never calls
// materializeFeedbackCards (src/lib/feedback/materialize.ts) — the badge
// should never be the thing that creates a card, only GET /api/feedback
// (opening /coach) does that.
//
// Same "always degrade, never throw a banner" convention as
// GET /api/dashboard/summary: no session, an un-migrated feedback_cards
// table, or a query error all fall back to { count: 0 } instead of a
// non-200 response — a nav badge should never surface an error.

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
    .from('feedback_cards')
    .select('id', { count: 'exact', head: true })
    .eq('rep_email', repEmail)
    .is('seen_at', null);
  if (error) {
    if (!isMissingTableError(error)) {
      console.error('Load unseen feedback card count failed:', error);
    }
    return NextResponse.json({ count: 0 });
  }

  return NextResponse.json({ count: count ?? 0 });
}
