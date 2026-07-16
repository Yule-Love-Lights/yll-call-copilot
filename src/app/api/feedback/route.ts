// GET /api/feedback — the signed-in rep's own feedback feed (/coach). Lazily
// materializes a feedback_cards row for any of their call_scores that don't
// have one yet (src/lib/feedback/materialize.ts's materializeFeedbackCards),
// then returns their newest 30 cards. This "materialize on read" step is the
// whole reason a card exists a few minutes after each call with no cron.
//
// No admin/team view here — that visibility toggle belongs to the
// scoreboard workstream; this route only ever returns the caller's own
// cards, resolved via the signed-in session (src/lib/auth/session.ts). A
// user with no app_users row never reaches this route at all — src/proxy.ts
// already blocks them before any route runs.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import { listFeedbackCards, materializeFeedbackCards } from '@/lib/feedback/materialize';
import type { FeedbackCardRow } from '@/lib/feedback/types';

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, cards: [] });
  }

  const repEmail = await getSessionEmail();
  if (!repEmail) {
    return NextResponse.json({ configured: true, cards: [], reason: 'Not signed in.' });
  }

  const supabase = getSupabaseServerClient()!;
  try {
    await materializeFeedbackCards(supabase, repEmail);
    const rows = (await listFeedbackCards(supabase, repEmail, 30)) as FeedbackCardRow[];
    return NextResponse.json({
      configured: true,
      migrated: true,
      cards: rows.map(r => ({
        id: r.id,
        praiseOnly: r.praise_only,
        card: r.card,
        seenAt: r.seen_at,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0008 first.', cards: [] });
    }
    console.error('Load feedback cards failed:', err);
    return NextResponse.json({ configured: true, error: 'Could not load feedback cards.', cards: [] }, { status: 500 });
  }
}
