// Runs one weekly brain review for one already-loaded vertical: loads this
// period's stats (src/lib/analytics/stats.ts) + the vertical's all-time
// learnings aggregate (src/lib/transcripts/insights.ts, shared with the
// distill route) + its current playbook + its most-repeated noise-rated
// coaching cards, makes ONE Claude call (src/lib/analytics/brainReview.ts),
// and stores the result as a brain_reviews row plus any proposals as pending
// playbook_proposals rows. Shared by POST /api/verticals/[id]/brain-review
// (the manual "Run weekly review" button) and the optional
// GET /api/cron/brain-review, so there is one place this orchestration
// lives rather than the cron route making an internal HTTP round-trip back
// into this same app (same "call the function directly" philosophy as
// computeInsights being shared between the insights and distill routes).

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '../supabase';
import { computeInsights } from '../transcripts/insights';
import { generateBrainReview } from './brainReview';
import { computeStats, loadStatsInputs, periodFromDays, topNoiseCardTexts } from './stats';
import type { Playbook } from '../playbook/types';

export type VerticalForReview = { id: string; slug: string; name: string; activeVersion: number };

export type SavedBrainReview = {
  id: string;
  periodStart: string;
  periodEnd: string;
  narrative: string;
  proposalsCreated: number;
  createdAt: string;
};

// `kind` lets each caller decide its own HTTP status (the manual POST route
// maps 'missing_table' -> a graceful 200, 'generation_failed' -> 502, and
// the rest -> 500, mirroring every other route's degrade convention); the
// cron route ignores it and just logs `reason` per vertical.
export type RunBrainReviewFailureKind = 'missing_table' | 'load_error' | 'generation_failed' | 'store_failed';

export type RunBrainReviewResult =
  | { ok: true; review: SavedBrainReview }
  | { ok: false; kind: RunBrainReviewFailureKind; reason: string };

export async function runBrainReview(
  supabase: SupabaseClient,
  vertical: VerticalForReview,
  periodDays: number,
): Promise<RunBrainReviewResult> {
  const { periodStart, periodEnd } = periodFromDays(periodDays);

  const statsInputsResult = await loadStatsInputs(supabase, {
    verticalId: vertical.id,
    verticalSlug: vertical.slug,
    from: periodStart,
    to: periodEnd,
  });
  if (!statsInputsResult.ok) {
    return statsInputsResult.missingTable
      ? { ok: false, kind: 'missing_table', reason: 'Run the calls/live-coaching migrations (0002-0005) first.' }
      : { ok: false, kind: 'load_error', reason: 'Could not load stats.' };
  }
  const stats = computeStats(statsInputsResult.inputs);
  const topNoiseCards = topNoiseCardTexts(statsInputsResult.inputs.coachingEvents);

  // All-time learnings aggregate, not scoped to this period — same aggregate
  // and the same reason distill already uses it all-time: a fresh playbook
  // proposal should draw on everything learned so far, refreshed weekly with
  // this period's stats, not reset to a thin one-week slice each run.
  const insightsResult = await computeInsights(supabase, vertical.id);
  if (!insightsResult.ok) {
    return insightsResult.missingTable
      ? { ok: false, kind: 'missing_table', reason: 'Run migration 0003 first.' }
      : { ok: false, kind: 'load_error', reason: 'Could not load insights.' };
  }

  let playbook: Playbook | null = null;
  if (vertical.activeVersion > 0) {
    const { data: versionData } = await supabase
      .from('playbook_versions')
      .select('content')
      .eq('vertical_id', vertical.id)
      .eq('version', vertical.activeVersion)
      .maybeSingle();
    playbook = (versionData as { content: Playbook } | null)?.content ?? null;
  }

  let review;
  try {
    review = await generateBrainReview({
      verticalName: vertical.name,
      periodStart,
      periodEnd,
      stats,
      insights: insightsResult.aggregate,
      playbook,
      topNoiseCards,
    });
  } catch (err) {
    console.error(`Generate brain review failed for vertical ${vertical.id}:`, err);
    return { ok: false, kind: 'generation_failed', reason: 'Review generation failed.' };
  }

  const { data: reviewData, error: insertReviewError } = await supabase
    .from('brain_reviews')
    .insert({
      vertical_id: vertical.id,
      period_start: periodStart,
      period_end: periodEnd,
      stats,
      narrative: review.narrative,
      proposals_created: review.proposals.length,
    })
    .select('id, created_at')
    .single();
  if (insertReviewError) {
    if (isMissingTableError(insertReviewError)) {
      return { ok: false, kind: 'missing_table', reason: 'Run migration 0006 first.' };
    }
    console.error(`Insert brain review failed for vertical ${vertical.id}:`, insertReviewError);
    return { ok: false, kind: 'store_failed', reason: 'Could not store the review.' };
  }
  const reviewRow = reviewData as { id: string; created_at: string };

  if (review.proposals.length > 0) {
    const { error: insertProposalsError } = await supabase.from('playbook_proposals').insert(
      review.proposals.map(p => ({
        vertical_id: vertical.id,
        section: p.section,
        kind: p.kind,
        current_value: p.current_value,
        proposed_value: p.proposed_value,
        evidence: p.evidence,
      })),
    );
    if (insertProposalsError) {
      // Non-fatal — the review itself (the narrative, the primary artifact)
      // already saved above. Best-effort, same convention as the follow-up
      // draft insert in POST /api/calls.
      console.error(`Insert brain review proposals failed for vertical ${vertical.id}:`, insertProposalsError);
    }
  }

  return {
    ok: true,
    review: {
      id: reviewRow.id,
      periodStart,
      periodEnd,
      narrative: review.narrative,
      proposalsCreated: review.proposals.length,
      createdAt: reviewRow.created_at,
    },
  };
}
