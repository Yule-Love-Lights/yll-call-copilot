// Lazily creates feedback_cards rows for a rep's call_scores rows that don't
// have one yet, deriving each card via deriveCard (pure, deterministic --
// see ./card.ts). This is what makes a card exist "minutes after each call"
// with no cron: GET /api/feedback calls materializeFeedbackCards() on every
// request before reading the feed.
//
// Testable with a fake Supabase client, same convention as leads/queue.ts's
// buildQueue -- genuine Supabase errors are thrown, not swallowed, so the
// calling route can translate a missing-table error via isMissingTableError
// (see POST /api/queue/build for the same split).

import type { SupabaseClient } from '@supabase/supabase-js';
import { deriveCard, isPraiseOnly } from './card';
import type { CallScoreRow } from './types';

export type MaterializeResult = { created: number };

// Postgres's unique_violation code. feedback_cards.call_score_id is unique,
// so two requests racing to materialize the same missing card can both pass
// the read-time check below and both attempt the insert -- the same
// compare-and-swap race POST /api/leads/[id]/decide guards against. The
// upsert's ignoreDuplicates option already turns this into ON CONFLICT DO
// NOTHING (no error at all in the normal case); this check is belt-and-
// braces so that even if a 23505 somehow surfaces anyway, the loser of the
// race never turns into a 500 for that rep.
const UNIQUE_VIOLATION = '23505';

export async function materializeFeedbackCards(
  supabase: SupabaseClient,
  repEmail: string,
): Promise<MaterializeResult> {
  const { data: scoreRows, error: scoresError } = await supabase
    .from('call_scores')
    .select('*')
    .eq('rep_email', repEmail);
  if (scoresError) throw scoresError;
  const scores = (scoreRows ?? []) as CallScoreRow[];
  if (scores.length === 0) return { created: 0 };

  const { data: existingRows, error: existingError } = await supabase
    .from('feedback_cards')
    .select('call_score_id')
    .in(
      'call_score_id',
      scores.map(s => s.id),
    );
  if (existingError) throw existingError;
  const existingIds = new Set((existingRows ?? []).map(r => (r as { call_score_id: string }).call_score_id));

  const missing = scores.filter(s => !existingIds.has(s.id));
  if (missing.length === 0) return { created: 0 };

  const rows = missing.map(score => ({
    call_score_id: score.id,
    transcript_id: score.transcript_id,
    rep_email: score.rep_email,
    praise_only: isPraiseOnly(score),
    card: deriveCard(score),
  }));

  const { error: upsertError } = await supabase
    .from('feedback_cards')
    .upsert(rows, { onConflict: 'call_score_id', ignoreDuplicates: true });
  if (upsertError) {
    const code = typeof upsertError === 'object' && upsertError !== null ? (upsertError as { code?: string }).code : undefined;
    if (code !== UNIQUE_VIOLATION) throw upsertError;
    console.error('Materialize feedback cards hit a duplicate-insert race (harmless, another request already won it):', upsertError);
  }

  return { created: rows.length };
}

// GET /api/feedback's feed read, after materializeFeedbackCards() has run.
// A thin select, same split as leads/queue.ts (the interesting logic lives
// in the function above; this is not worth its own dedicated test beyond
// what the route-level manual check covers).
export async function listFeedbackCards(supabase: SupabaseClient, repEmail: string, limit = 30) {
  const { data, error } = await supabase
    .from('feedback_cards')
    .select('*')
    .eq('rep_email', repEmail)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
