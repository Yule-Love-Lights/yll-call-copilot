// POST /api/feedback/[id]/seen — stamps seen_at the first time the
// signed-in rep opens a feedback card in /coach. Scoped to the caller's own
// card (eq('rep_email', repEmail) on the update) — another rep's card id
// 404s rather than silently stamping a card that isn't theirs. Idempotent:
// calling it again on an already-seen card just refreshes seen_at, never
// errors.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, seen: false, reason: 'Supabase not configured.' });
  }

  const { id } = await params;
  const repEmail = await getSessionEmail();
  if (!repEmail) {
    return NextResponse.json({ configured: true, seen: false, reason: 'Not signed in.' }, { status: 401 });
  }

  const supabase = getSupabaseServerClient()!;
  const { data, error } = await supabase
    .from('feedback_cards')
    .update({ seen_at: new Date().toISOString() })
    .eq('id', id)
    .eq('rep_email', repEmail)
    .select('id');
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, seen: false, reason: 'Run migration 0008 first.' });
    }
    console.error('Mark feedback card seen failed:', error);
    return NextResponse.json({ configured: true, seen: false, error: 'Could not update the card.' }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ configured: true, seen: false, reason: 'Card not found.' }, { status: 404 });
  }

  return NextResponse.json({ configured: true, seen: true });
}
