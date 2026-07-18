// Pure aggregation for the "Brain" view (Wave 1, PR A): three lenses over
// knowledge the app already has scattered across several tables (see
// src/lib/brain/loader.ts for the Supabase I/O). Same split as
// src/lib/analytics/stats.ts / src/lib/digest/stats.ts: this file takes
// already-fetched rows and returns shaped view models, so it's
// fixture-testable with no Supabase involved; the loader is the thin,
// untested orchestrator.
//
// Coaching lens privacy: this file NEVER reads or returns a rep's win text
// or fix moment (see CoachingCallRow below, which has no such fields) — the
// same "narrow shape enforces the rule structurally" pattern
// src/lib/scoreboard/stats.ts uses for the transparency board.

import { lowestDimensions, teamAverages, type CallScoreRow as DigestCallScoreRow, type DimensionStat, type TeamStats } from '../digest/stats';
import type { DocumentKind, Objection, TranscriptOutcome } from '../transcripts/types';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Dedupes case-insensitively (real calls phrase the same item with
// different casing) while keeping the first-seen casing for display. Same
// helper shape as src/lib/transcripts/insights.ts's topByFrequency and
// src/lib/analytics/stats.ts's topNoiseCardTexts — a third instance of an
// established small pattern, not a new one.
export function topByFrequency(items: string[], limit: number): { item: string; count: number }[] {
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

// Objection frequency is "% of calls that raised it at least once" (a call
// mentioning the same objection twice only counts once) — same convention
// and same dedupe rationale as computeInsights in
// src/lib/transcripts/insights.ts, just aggregated across every vertical
// instead of one.
function topObjectionsAcrossCalls(
  learningsRows: { objections: Objection[] }[],
  limit: number,
): { objection: string; count: number; pct: number }[] {
  const counts = new Map<string, { display: string; count: number }>();
  const totalCalls = learningsRows.length;
  for (const row of learningsRows) {
    const seenThisCall = new Set<string>();
    for (const o of row.objections) {
      const trimmed = o.objection.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seenThisCall.has(key)) continue;
      seenThisCall.add(key);
      const existing = counts.get(key);
      if (existing) existing.count++;
      else counts.set(key, { display: trimmed, count: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(({ display, count }) => ({
      objection: display,
      count,
      pct: totalCalls > 0 ? round1((count / totalCalls) * 100) : 0,
    }));
}

// ─── brain_insights (from sibling PR B, migration 0015) ─────────────────────
// Read optimistically by the loader; degrades to an empty array via
// isMissingTableError before migration 0015 lands, so this whole module
// works identically before and after that PR merges.

export type BrainInsightSource = 'interview' | 'manual';
export type BrainInsightLens = 'market' | 'leads' | 'coaching' | 'general';

export type BrainInsight = {
  id: string;
  verticalId: string | null;
  verticalName: string | null;
  source: BrainInsightSource;
  lens: BrainInsightLens;
  title: string;
  content: string;
  createdBy: string | null;
  createdAt: string;
};

// 'general' insights aren't lensed to one card, so they fold into all
// three (a judgment call — the spec named market/coaching explicitly for
// "appears under their lens" but didn't say what happens to 'general';
// showing it everywhere beats inventing a fourth card for Wave 1).
function insightsForLens(insights: BrainInsight[], lens: Exclude<BrainInsightLens, 'general'>): BrainInsight[] {
  return insights
    .filter(i => i.lens === lens || i.lens === 'general')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ─── Market brain: what we know about the market/customers ─────────────────

export type MarketVerticalNote = { verticalId: string; verticalName: string; notes: string };
export type MarketDocument = { id: string; verticalId: string; verticalName: string; title: string; kind: DocumentKind; createdAt: string };
export type MarketDocumentsByVertical = { verticalId: string; verticalName: string; count: number };
export type CustomerPhrase = { phrase: string; count: number };

export type MarketLens = {
  verticalNotes: MarketVerticalNote[];
  documentsTotal: number;
  documentsByVertical: MarketDocumentsByVertical[];
  recentDocuments: MarketDocument[];
  topCustomerLanguage: CustomerPhrase[];
  insights: BrainInsight[];
};

export type MarketLensInput = {
  verticals: { id: string; name: string; knowledgeNotes: string }[];
  documents: { id: string; verticalId: string | null; title: string; kind: DocumentKind; createdAt: string }[];
  customerLanguage: string[]; // flattened across every learnings row, every vertical
  insights: BrainInsight[];
};

const RECENT_DOCUMENTS_LIMIT = 6;
const TOP_CUSTOMER_LANGUAGE_LIMIT = 8;

export function buildMarketLens(input: MarketLensInput): MarketLens {
  const nameById = new Map(input.verticals.map(v => [v.id, v.name]));

  const verticalNotes = input.verticals
    .filter(v => v.knowledgeNotes.trim().length > 0)
    .map(v => ({ verticalId: v.id, verticalName: v.name, notes: v.knowledgeNotes.trim() }));

  const docsByVertical = new Map<string, number>();
  for (const d of input.documents) {
    if (!d.verticalId) continue;
    docsByVertical.set(d.verticalId, (docsByVertical.get(d.verticalId) ?? 0) + 1);
  }
  const documentsByVertical = [...docsByVertical.entries()]
    .map(([verticalId, count]) => ({ verticalId, verticalName: nameById.get(verticalId) ?? '(unknown vertical)', count }))
    .sort((a, b) => b.count - a.count || a.verticalName.localeCompare(b.verticalName));

  const recentDocuments = [...input.documents]
    .filter((d): d is typeof d & { verticalId: string } => d.verticalId !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, RECENT_DOCUMENTS_LIMIT)
    .map(d => ({ id: d.id, verticalId: d.verticalId, verticalName: nameById.get(d.verticalId) ?? '(unknown vertical)', title: d.title, kind: d.kind, createdAt: d.createdAt }));

  const topCustomerLanguage = topByFrequency(input.customerLanguage, TOP_CUSTOMER_LANGUAGE_LIMIT).map(({ item, count }) => ({
    phrase: item,
    count,
  }));

  return {
    verticalNotes,
    documentsTotal: input.documents.length,
    documentsByVertical,
    recentDocuments,
    topCustomerLanguage,
    insights: insightsForLens(input.insights, 'market'),
  };
}

// ─── Leads brain: what converts ─────────────────────────────────────────────

export type LeadsOutcomeMix = { booked: number; notBooked: number; unknown: number; total: number; bookedRate: number | null };
export type LeadsVerticalConversion = { verticalId: string; verticalName: string; total: number; booked: number; bookedRate: number | null };
export type LeadsObjection = { objection: string; count: number; pct: number };

export type LeadsLens = {
  outcomeMix: LeadsOutcomeMix;
  topObjections: LeadsObjection[];
  byVertical: LeadsVerticalConversion[];
  insights: BrainInsight[];
};

export type LeadsLensInput = {
  verticals: { id: string; name: string }[];
  transcripts: { verticalId: string | null; outcome: TranscriptOutcome }[];
  learningsObjections: { objections: Objection[] }[];
  insights: BrainInsight[];
};

const TOP_OBJECTIONS_LIMIT = 10;

// bookedRate is null (not 0%) when there's no known-outcome transcript at
// all — "no data" and "never books" must render differently, same
// null-means-no-baseline convention src/lib/scoreboard/stats.ts uses for
// improvementDelta.
function bookedRate(booked: number, notBooked: number): number | null {
  const known = booked + notBooked;
  return known > 0 ? round1((booked / known) * 100) : null;
}

export function buildLeadsLens(input: LeadsLensInput): LeadsLens {
  const nameById = new Map(input.verticals.map(v => [v.id, v.name]));

  const booked = input.transcripts.filter(t => t.outcome === 'booked').length;
  const notBooked = input.transcripts.filter(t => t.outcome === 'not_booked').length;
  const unknown = input.transcripts.filter(t => t.outcome === 'unknown').length;

  const byVerticalCounts = new Map<string, { total: number; booked: number; notBooked: number }>();
  for (const t of input.transcripts) {
    if (!t.verticalId) continue;
    const bucket = byVerticalCounts.get(t.verticalId) ?? { total: 0, booked: 0, notBooked: 0 };
    bucket.total++;
    if (t.outcome === 'booked') bucket.booked++;
    if (t.outcome === 'not_booked') bucket.notBooked++;
    byVerticalCounts.set(t.verticalId, bucket);
  }
  const byVertical = [...byVerticalCounts.entries()]
    .map(([verticalId, b]) => ({
      verticalId,
      verticalName: nameById.get(verticalId) ?? '(unknown vertical)',
      total: b.total,
      booked: b.booked,
      bookedRate: bookedRate(b.booked, b.notBooked),
    }))
    .sort((a, b) => {
      if (a.bookedRate !== null && b.bookedRate !== null) return b.bookedRate - a.bookedRate || b.total - a.total;
      if (a.bookedRate !== null) return -1;
      if (b.bookedRate !== null) return 1;
      return b.total - a.total || a.verticalName.localeCompare(b.verticalName);
    });

  return {
    outcomeMix: { booked, notBooked, unknown, total: input.transcripts.length, bookedRate: bookedRate(booked, notBooked) },
    topObjections: topObjectionsAcrossCalls(input.learningsObjections, TOP_OBJECTIONS_LIMIT),
    byVertical,
    insights: insightsForLens(input.insights, 'leads'),
  };
}

// ─── Coaching brain: how the team performs ──────────────────────────────────
//
// CoachingCallRow deliberately has no `win`/`fix` field — same "narrow shape
// enforces the privacy rule structurally, not by remembering to omit it at
// render time" convention as src/lib/scoreboard/stats.ts's own CallScoreRow.
// buildCoachingLens hands `fix: null, win: null` to the digest math it
// reuses (teamAverages/lowestDimensions never read either field), so no
// rep's individual fix/rough-moment text ever has to exist in this module
// to compute the team aggregate.

export type CoachingCallRow = {
  repEmail: string | null;
  overall: number;
  experienceScore: number;
  emotional: DigestCallScoreRow['emotional'];
  sales: DigestCallScoreRow['sales'];
  hospitality: DigestCallScoreRow['hospitality'];
};

export type CoachingLens = {
  team: TeamStats;
  lowestDimensions: DimensionStat[];
  topWhatWorked: { item: string; count: number }[];
  topWhatFailed: { item: string; count: number }[];
  pendingProposals: number;
  insights: BrainInsight[];
};

export type CoachingLensInput = {
  callScores: CoachingCallRow[];
  learningsRows: { whatWorked: string[]; whatFailed: string[] }[];
  pendingProposals: number;
  insights: BrainInsight[];
};

const TOP_THEME_LIMIT = 6;
const LOWEST_DIMENSIONS_COUNT = 3;

export function buildCoachingLens(input: CoachingLensInput): CoachingLens {
  // fix/win hardcoded to null (never sourced from a DB column here) — see
  // module comment above. Neither teamAverages nor dimensionLeaderboard
  // reads them.
  const digestRows: DigestCallScoreRow[] = input.callScores.map(r => ({
    id: '',
    repEmail: r.repEmail,
    overall: r.overall,
    experienceScore: r.experienceScore,
    win: null,
    fix: null,
    emotional: r.emotional,
    sales: r.sales,
    hospitality: r.hospitality,
    guarantees: null,
  }));

  return {
    team: teamAverages(digestRows),
    lowestDimensions: lowestDimensions(digestRows, LOWEST_DIMENSIONS_COUNT),
    topWhatWorked: topByFrequency(input.learningsRows.flatMap(r => r.whatWorked), TOP_THEME_LIMIT),
    topWhatFailed: topByFrequency(input.learningsRows.flatMap(r => r.whatFailed), TOP_THEME_LIMIT),
    pendingProposals: input.pendingProposals,
    insights: insightsForLens(input.insights, 'coaching'),
  };
}

// ─── Stats strip: "learns every call" ───────────────────────────────────────

export type BrainStats = { transcriptsLearned: number; callsScored: number; lastLearnedAt: string | null };

export function buildBrainStats(params: { learningsExtractedAt: string[]; callsScoredCount: number }): BrainStats {
  const lastLearnedAt = params.learningsExtractedAt.length > 0 ? params.learningsExtractedAt.reduce((a, b) => (a > b ? a : b)) : null;
  return {
    transcriptsLearned: params.learningsExtractedAt.length,
    callsScored: params.callsScoredCount,
    lastLearnedAt,
  };
}
