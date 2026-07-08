// Aggregates a vertical's learnings into the shape both
// GET /api/verticals/[id]/insights renders and distillProposals() consumes.
// Factored out of the insights route so the distill route can call it
// directly instead of making an internal HTTP round-trip to its own app.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '../supabase';
import type { InsightsAggregate } from './distill';
import type { LearningsRow, TranscriptRow } from './types';

// Dedupes case-insensitively (real calls phrase the same question or item
// with different casing) while keeping the first-seen casing for display.
function topByFrequency(items: string[], limit: number): { item: string; count: number }[] {
  const counts = new Map<string, { display: string; count: number }>();
  for (const raw of items) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { display: trimmed, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(({ display, count }) => ({ item: display, count }));
}

export type ComputeInsightsResult =
  | { ok: true; aggregate: InsightsAggregate; extractedCalls: number }
  | { ok: false; missingTable: boolean };

export async function computeInsights(supabase: SupabaseClient, verticalId: string): Promise<ComputeInsightsResult> {
  const { data: transcriptRows, error: transcriptError } = await supabase
    .from('transcripts')
    .select('id, outcome')
    .eq('vertical_id', verticalId);
  if (transcriptError) {
    if (!isMissingTableError(transcriptError)) console.error('Load transcripts for insights failed:', transcriptError);
    return { ok: false, missingTable: isMissingTableError(transcriptError) };
  }

  const { data: learningsRows, error: learningsError } = await supabase
    .from('learnings')
    .select('objections, customer_language, what_worked, what_failed, price_talk, questions')
    .eq('vertical_id', verticalId);
  if (learningsError) {
    if (!isMissingTableError(learningsError)) console.error('Load learnings for insights failed:', learningsError);
    return { ok: false, missingTable: isMissingTableError(learningsError) };
  }

  const transcripts = (transcriptRows ?? []) as Pick<TranscriptRow, 'id' | 'outcome'>[];
  const learnings = (learningsRows ?? []) as Pick<
    LearningsRow,
    'objections' | 'customer_language' | 'what_worked' | 'what_failed' | 'price_talk' | 'questions'
  >[];

  const totalCalls = transcripts.length;
  const booked = transcripts.filter(t => t.outcome === 'booked').length;
  const notBooked = transcripts.filter(t => t.outcome === 'not_booked').length;
  const unknownOutcome = totalCalls - booked - notBooked;

  // Objection frequency is "% of extracted calls that raised it at least
  // once", so a call mentioning the same objection twice only counts once.
  // Dedupes case-insensitively, same rationale as topByFrequency.
  const objectionCallCount = new Map<string, { display: string; count: number }>();
  const extractedCalls = learnings.length;
  for (const row of learnings) {
    const seenThisCall = new Set<string>();
    for (const o of row.objections ?? []) {
      const trimmed = o.objection.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seenThisCall.has(key)) continue;
      seenThisCall.add(key);
      const existing = objectionCallCount.get(key);
      if (existing) existing.count++;
      else objectionCallCount.set(key, { display: trimmed, count: 1 });
    }
  }
  const topObjections = [...objectionCallCount.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map(({ display, count }) => ({
      objection: display,
      count,
      pct: extractedCalls > 0 ? Math.round((count / extractedCalls) * 1000) / 10 : 0,
    }));

  const topQuestions = topByFrequency(
    learnings.flatMap(r => r.questions ?? []),
    10,
  ).map(({ item, count }) => ({ question: item, count }));
  const topWhatWorked = topByFrequency(learnings.flatMap(r => r.what_worked ?? []), 10);
  const topWhatFailed = topByFrequency(learnings.flatMap(r => r.what_failed ?? []), 10);
  const samplePriceTalk = learnings.flatMap(r => r.price_talk ?? []).slice(0, 10);

  const aggregate: InsightsAggregate = {
    totalCalls,
    booked,
    notBooked,
    unknownOutcome,
    topObjections,
    topQuestions,
    topWhatWorked,
    topWhatFailed,
    samplePriceTalk,
  };

  return { ok: true, aggregate, extractedCalls };
}
