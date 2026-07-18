// Supabase I/O for the "Brain" view: fetches verticals (0002), the
// documents/learnings/transcripts knowledge tables (0003), call_scores
// (0008), playbook_proposals (0003), and brain_insights (0015, sibling PR B)
// once, maps them into src/lib/brain/lenses.ts's input shapes, and runs the
// three lenses. Kept separate from lenses.ts so the aggregation stays pure
// and fixture-testable — same loader/aggregator split as
// src/lib/analytics/stats.ts and src/lib/digest/loadCallScores.ts.
//
// Degrade policy (three different tiers, on purpose):
//  - verticals or documents/learnings/transcripts missing (0002/0003) is a
//    hard failure — nearly nothing on this page has a source without them,
//    same as every other route that reads these tables.
//  - call_scores missing (0008) degrades ONLY the coaching lens (market and
//    leads have nothing to do with scoring) — `coaching: null` plus a
//    `coachingReason` the route can surface as its own "Run migration"
//    banner, same shape used elsewhere in this app.
//  - brain_insights missing (0015) degrades silently to an empty list: that
//    table belongs to a sibling PR that may not have landed yet, so this
//    view must work identically before and after it does.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '../supabase';
import {
  buildBrainStats,
  buildCoachingLens,
  buildLeadsLens,
  buildMarketLens,
  type BrainInsight,
  type BrainInsightLens,
  type BrainInsightSource,
  type BrainStats,
  type CoachingCallRow,
  type CoachingLens,
  type LeadsLens,
  type MarketLens,
} from './lenses';
import type { DocumentKind, Objection, TranscriptOutcome } from '../transcripts/types';

export type BrainView = {
  market: MarketLens;
  leads: LeadsLens;
  coaching: CoachingLens | null;
  coachingReason: string | null;
  stats: BrainStats;
};

export type LoadBrainResult = { ok: true; view: BrainView } | { ok: false; reason: string };

export async function loadBrainView(supabase: SupabaseClient): Promise<LoadBrainResult> {
  const { data: verticalRows, error: verticalsError } = await supabase.from('verticals').select('id, name, knowledge_notes');
  if (verticalsError) {
    if (!isMissingTableError(verticalsError)) console.error('Load verticals for brain failed:', verticalsError);
    return { ok: false, reason: isMissingTableError(verticalsError) ? 'Run migration 0002 first.' : 'Could not load verticals.' };
  }
  const verticals = ((verticalRows ?? []) as { id: string; name: string; knowledge_notes: string }[]).map(v => ({
    id: v.id,
    name: v.name,
    knowledgeNotes: v.knowledge_notes,
  }));
  const verticalNameById = new Map(verticals.map(v => [v.id, v.name]));

  const { data: documentRows, error: documentsError } = await supabase.from('documents').select('id, vertical_id, title, kind, created_at');
  if (documentsError) {
    if (!isMissingTableError(documentsError)) console.error('Load documents for brain failed:', documentsError);
    return { ok: false, reason: isMissingTableError(documentsError) ? 'Run migration 0003 first.' : 'Could not load documents.' };
  }

  const { data: learningsRows, error: learningsError } = await supabase
    .from('learnings')
    .select('objections, customer_language, what_worked, what_failed, extracted_at');
  if (learningsError) {
    if (!isMissingTableError(learningsError)) console.error('Load learnings for brain failed:', learningsError);
    return { ok: false, reason: isMissingTableError(learningsError) ? 'Run migration 0003 first.' : 'Could not load learnings.' };
  }

  const { data: transcriptRows, error: transcriptsError } = await supabase.from('transcripts').select('vertical_id, outcome');
  if (transcriptsError) {
    if (!isMissingTableError(transcriptsError)) console.error('Load transcripts for brain failed:', transcriptsError);
    return { ok: false, reason: isMissingTableError(transcriptsError) ? 'Run migration 0003 first.' : 'Could not load transcripts.' };
  }

  // Best-effort pending-proposals count for the coaching card — a failure
  // here (missing table or otherwise) just falls back to 0 rather than
  // degrading the whole page over one minor number.
  const { count: pendingProposalsCount, error: proposalsError } = await supabase
    .from('playbook_proposals')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (proposalsError && !isMissingTableError(proposalsError)) {
    console.error('Load pending playbook_proposals count for brain failed:', proposalsError);
  }

  // brain_insights (0015) — read optimistically; missing table silently
  // becomes an empty list (see module comment).
  const { data: insightRows, error: insightsError } = await supabase
    .from('brain_insights')
    .select('id, vertical_id, source, lens, title, content, created_by, created_at');
  if (insightsError && !isMissingTableError(insightsError)) {
    console.error('Load brain_insights failed:', insightsError);
  }
  const insights: BrainInsight[] = insightsError
    ? []
    : (
        (insightRows ?? []) as {
          id: string;
          vertical_id: string | null;
          source: BrainInsightSource;
          lens: BrainInsightLens;
          title: string;
          content: string;
          created_by: string | null;
          created_at: string;
        }[]
      ).map(r => ({
        id: r.id,
        verticalId: r.vertical_id,
        verticalName: r.vertical_id ? (verticalNameById.get(r.vertical_id) ?? null) : null,
        source: r.source,
        lens: r.lens,
        title: r.title,
        content: r.content,
        createdBy: r.created_by,
        createdAt: r.created_at,
      }));

  const documents = ((documentRows ?? []) as { id: string; vertical_id: string | null; title: string; kind: DocumentKind; created_at: string }[]).map(
    d => ({ id: d.id, verticalId: d.vertical_id, title: d.title, kind: d.kind, createdAt: d.created_at }),
  );

  const learnings = (learningsRows ?? []) as {
    objections: Objection[] | null;
    customer_language: string[] | null;
    what_worked: string[] | null;
    what_failed: string[] | null;
    extracted_at: string;
  }[];

  const transcripts = ((transcriptRows ?? []) as { vertical_id: string | null; outcome: TranscriptOutcome }[]).map(t => ({
    verticalId: t.vertical_id,
    outcome: t.outcome,
  }));

  const market = buildMarketLens({
    verticals,
    documents,
    customerLanguage: learnings.flatMap(l => l.customer_language ?? []),
    insights,
  });

  const leads = buildLeadsLens({
    verticals,
    transcripts,
    learningsObjections: learnings.map(l => ({ objections: l.objections ?? [] })),
    insights,
  });

  // call_scores (0008) — coaching lens only; see module comment for why a
  // missing table here degrades just this lens.
  const { data: callScoreRows, error: callScoresError } = await supabase
    .from('call_scores')
    .select('rep_email, overall, experience_score, emotional, sales, hospitality');

  let coaching: CoachingLens | null = null;
  let coachingReason: string | null = null;
  let callsScoredCount = 0;

  if (!callScoresError) {
    const callScores: CoachingCallRow[] = (
      (callScoreRows ?? []) as {
        rep_email: string | null;
        overall: number;
        experience_score: number;
        emotional: CoachingCallRow['emotional'];
        sales: CoachingCallRow['sales'];
        hospitality: CoachingCallRow['hospitality'];
      }[]
    ).map(r => ({
      repEmail: r.rep_email,
      overall: r.overall,
      experienceScore: r.experience_score,
      emotional: r.emotional,
      sales: r.sales,
      hospitality: r.hospitality,
    }));
    callsScoredCount = callScores.length;
    coaching = buildCoachingLens({
      callScores,
      learningsRows: learnings.map(l => ({ whatWorked: l.what_worked ?? [], whatFailed: l.what_failed ?? [] })),
      pendingProposals: pendingProposalsCount ?? 0,
      insights,
    });
  } else if (isMissingTableError(callScoresError)) {
    coachingReason = 'Run migration 0008 first.';
  } else {
    console.error('Load call_scores for brain failed:', callScoresError);
    coachingReason = 'Could not load coaching data.';
  }

  const stats = buildBrainStats({
    learningsExtractedAt: learnings.map(l => l.extracted_at),
    callsScoredCount,
  });

  return { ok: true, view: { market, leads, coaching, coachingReason, stats } };
}
