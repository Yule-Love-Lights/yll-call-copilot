// Pure aggregation over call_scores rows (see migration 0008 -- the scoring
// engine's per-call output) for the weekly digest: team averages, per-rep
// averages with a week-over-week delta, the dimension leaderboard (the
// three lowest-scoring dimensions become the week's training focus),
// guarantee say-rates, the best call to celebrate, and the roughest moment
// worth a private 1:1. Same split as src/lib/analytics/stats.ts: this file
// stays pure and fixture-testable, the Supabase loader lives in
// src/lib/digest/loadCallScores.ts.

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

// ─── call_scores row shape (the scoring engine's exact contract) ───────────

export type ScoreMaxNote = { score: number; max: number; notes?: string | null };
export type GuaranteeEntry = { applicable: boolean; done: boolean; notes?: string | null };
export type FixMoment = { moment: string; timestampSeconds: number; transcriptQuote: string; betterLine: string };
// matchedTrack is a compliance flag ("did the rep run the right track for
// the diagnosed state"), not the track name itself -- it was typed as
// string here, which never matched what the scorer actually writes
// (matched_track: boolean); loadCallScores.ts maps it explicitly now.
export type EmotionalScore = {
  state: string | null;
  namedBack: boolean | null;
  matchedTrack: boolean | null;
  grade: number | null; // 0-10
  notes?: string | null;
};

export const GUARANTEE_KEYS = [
  'fast_fix_48h',
  'all_inclusive',
  'lease_disclosure',
  'labor_warranty_3yr',
  'referral_ask',
  'rebook_lock',
  'permanent_seed',
] as const;
export type GuaranteeKey = (typeof GUARANTEE_KEYS)[number];

export type SalesDim = 'opening' | 'discovery' | 'value' | 'objections' | 'close';
export type HospitalityDim = 'greeting' | 'listening' | 'courtesy' | 'dead_air' | 'warm_ending';

// One row of call_scores, mapped from snake_case columns to the fields this
// module actually reads (rubric_version/transcript_id/vertical_slug/
// hard_metrics/experience aren't used by any digest aggregation, so they're
// left off this narrower type rather than carried through unused).
export type CallScoreRow = {
  id: string;
  // Nullable for real: historical imports score with rep_email null. They
  // count in team totals; groupByRep drops them from per-rep rows.
  repEmail: string | null;
  overall: number; // 0-100
  experienceScore: number; // 0-10
  win: string | null;
  fix: FixMoment | null;
  emotional: EmotionalScore | null;
  sales: Partial<Record<SalesDim, ScoreMaxNote>> | null;
  hospitality: Partial<Record<HospitalityDim, ScoreMaxNote>> | null;
  guarantees: Partial<Record<GuaranteeKey, GuaranteeEntry>> | null;
};

// ─── Dimension leaderboard (pure) ───────────────────────────────────────────

// The 11 gradeable dimensions: emotional diagnosis/match (graded on its own,
// out of 10) plus the 5 sales-side and 5 hospitality-side dimensions (each
// scored out of that dimension's own max). Order here doubles as the
// alphabetical tie-break fallback isn't needed for this list itself -- see
// lowestDimensions, which sorts by key string for ties in the computed
// average, not this declaration order.
export const DIMENSION_KEYS = [
  'emotional_match',
  'sales_opening',
  'sales_discovery',
  'sales_value',
  'sales_objections',
  'sales_close',
  'hospitality_greeting',
  'hospitality_listening',
  'hospitality_courtesy',
  'hospitality_dead_air',
  'hospitality_warm_ending',
] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  emotional_match: 'Emotional diagnosis and match',
  sales_opening: 'Opening and rapport',
  sales_discovery: 'Discovery depth',
  sales_value: 'Value presentation',
  sales_objections: 'Objection handling',
  sales_close: 'Close',
  hospitality_greeting: 'Greeting quality',
  hospitality_listening: 'Active listening',
  hospitality_courtesy: 'Courtesy language',
  hospitality_dead_air: 'Dead air and interruptions',
  hospitality_warm_ending: 'Warm ending',
};

// Reads one dimension's {score,max} off a row, tolerating a row that never
// recorded this dimension (an older rubric version, a partial score) --
// returns null rather than throwing, so one row's gap never breaks the
// team average, it just isn't counted toward it.
function readDimension(row: CallScoreRow, key: DimensionKey): { score: number; max: number } | null {
  if (key === 'emotional_match') {
    const grade = row.emotional?.grade;
    return typeof grade === 'number' && Number.isFinite(grade) ? { score: grade, max: 10 } : null;
  }
  const [side, sub] = key.startsWith('sales_') ? (['sales', key.slice(6)] as const) : (['hospitality', key.slice(12)] as const);
  const bucket = side === 'sales' ? row.sales : row.hospitality;
  const entry = bucket ? (bucket as Record<string, ScoreMaxNote | undefined>)[sub] : undefined;
  if (!entry || typeof entry.score !== 'number' || typeof entry.max !== 'number' || entry.max <= 0) return null;
  return { score: entry.score, max: entry.max };
}

export type DimensionStat = { key: DimensionKey; label: string; avgRatio: number; calls: number };

// Team average ratio (as a percent, 1 decimal) for every dimension that has
// at least one contributing row, sorted ascending so the lowest lead --
// callers slice the first N. Ties break alphabetically by key (deterministic
// and stable across runs, since two dimensions landing on the exact same
// average is otherwise an arbitrary pick).
export function dimensionLeaderboard(rows: CallScoreRow[]): DimensionStat[] {
  const stats: DimensionStat[] = [];
  for (const key of DIMENSION_KEYS) {
    const ratios: number[] = [];
    for (const row of rows) {
      const dim = readDimension(row, key);
      if (dim) ratios.push(dim.score / dim.max);
    }
    if (ratios.length === 0) continue;
    stats.push({ key, label: DIMENSION_LABELS[key], avgRatio: round1(mean(ratios) * 100), calls: ratios.length });
  }
  return stats.sort((a, b) => a.avgRatio - b.avgRatio || a.key.localeCompare(b.key));
}

// The week's training focus: the three lowest-scoring dimensions (fewer if
// fewer than 3 dimensions had any data this week).
export function lowestDimensions(rows: CallScoreRow[], count = 3): DimensionStat[] {
  return dimensionLeaderboard(rows).slice(0, count);
}

// ─── Team + per-rep averages (pure) ─────────────────────────────────────────

export type TeamStats = { calls: number; reps: number; avgOverall: number | null; avgExperience: number | null };

export function teamAverages(rows: CallScoreRow[]): TeamStats {
  if (rows.length === 0) return { calls: 0, reps: 0, avgOverall: null, avgExperience: null };
  return {
    calls: rows.length,
    reps: new Set(rows.map(r => r.repEmail)).size,
    avgOverall: round1(mean(rows.map(r => r.overall))),
    avgExperience: round1(mean(rows.map(r => r.experienceScore))),
  };
}

export type RepAverage = {
  repEmail: string;
  calls: number;
  avgOverall: number;
  avgExperience: number;
  // null when the rep has no calls in the prior week to compare against --
  // not "0 change", genuinely no baseline.
  deltaOverall: number | null;
  deltaExperience: number | null;
};

function groupByRep(rows: CallScoreRow[]): Map<string, CallScoreRow[]> {
  const groups = new Map<string, CallScoreRow[]>();
  for (const row of rows) {
    // Unattributed calls (rep_email null on historical imports) stay in the
    // team totals but never form a rep row -- a null key crashed the
    // localeCompare sort below on first contact with real data.
    if (row.repEmail === null) continue;
    const list = groups.get(row.repEmail) ?? [];
    list.push(row);
    groups.set(row.repEmail, list);
  }
  return groups;
}

// Sorted alphabetically by rep email for a stable, deterministic order (the
// UI and tests both benefit from not depending on Map iteration/insertion
// order).
export function repAverages(thisWeek: CallScoreRow[], lastWeek: CallScoreRow[]): RepAverage[] {
  const thisWeekByRep = groupByRep(thisWeek);
  const lastWeekByRep = groupByRep(lastWeek);

  return [...thisWeekByRep.entries()]
    .map(([repEmail, calls]) => {
      const avgOverall = round1(mean(calls.map(c => c.overall)));
      const avgExperience = round1(mean(calls.map(c => c.experienceScore)));
      const lastWeekCalls = lastWeekByRep.get(repEmail);
      const deltaOverall = lastWeekCalls ? round1(avgOverall - mean(lastWeekCalls.map(c => c.overall))) : null;
      const deltaExperience = lastWeekCalls ? round1(avgExperience - mean(lastWeekCalls.map(c => c.experienceScore))) : null;
      return { repEmail, calls: calls.length, avgOverall, avgExperience, deltaOverall, deltaExperience };
    })
    .sort((a, b) => a.repEmail.localeCompare(b.repEmail));
}

// ─── Guarantee say-rates (pure) ──────────────────────────────────────────────

export type GuaranteeRate = { key: GuaranteeKey; label: string; done: number; applicable: number; rate: number | null };

export const GUARANTEE_LABELS: Record<GuaranteeKey, string> = {
  fast_fix_48h: '48-hour fast-fix guarantee',
  all_inclusive: 'All-inclusive pricing line',
  lease_disclosure: 'Lease disclosure',
  labor_warranty_3yr: '3-year labor warranty',
  referral_ask: 'Referral ask',
  rebook_lock: 'Rebook lock',
  permanent_seed: 'Permanent-lighting seed',
};

// applicable = 0 means the guarantee never came up this week (not "0% say
// rate") -- rate is null so callers render "n/a", never a divide-by-zero 0%.
export function guaranteeSayRates(rows: CallScoreRow[]): GuaranteeRate[] {
  return GUARANTEE_KEYS.map(key => {
    let done = 0;
    let applicable = 0;
    for (const row of rows) {
      const entry = row.guarantees?.[key];
      if (!entry?.applicable) continue;
      applicable++;
      if (entry.done) done++;
    }
    return { key, label: GUARANTEE_LABELS[key], done, applicable, rate: applicable > 0 ? round1((done / applicable) * 100) : null };
  });
}

// ─── Best call / roughest moment (pure) ─────────────────────────────────────

export type BestCall = { id: string; repEmail: string; overall: number; win: string | null };
export type RoughestMoment = { id: string; repEmail: string; overall: number; fix: FixMoment };

// Highest overall this week -- the call worth celebrating. Ties break by id
// so the pick is deterministic.
export function bestCall(rows: CallScoreRow[]): BestCall | null {
  if (rows.length === 0) return null;
  const top = [...rows].sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id))[0];
  return { id: top.id, repEmail: top.repEmail ?? 'unattributed', overall: top.overall, win: top.win };
}

// Lowest overall among calls that actually recorded a fix moment -- a low
// score with no fix has nothing concrete for a private 1:1 or a role-play,
// so it's left out of this pick entirely.
export function roughestMoment(rows: CallScoreRow[]): RoughestMoment | null {
  const withFix = rows.filter((r): r is CallScoreRow & { fix: FixMoment } => r.fix !== null);
  if (withFix.length === 0) return null;
  const worst = [...withFix].sort((a, b) => a.overall - b.overall || a.id.localeCompare(b.id))[0];
  return { id: worst.id, repEmail: worst.repEmail ?? 'unattributed', overall: worst.overall, fix: worst.fix };
}

// ─── Full digest stats (pure) ───────────────────────────────────────────────

export type DigestStats = {
  periodStart: string;
  periodEnd: string;
  team: TeamStats;
  reps: RepAverage[];
  lowestDimensions: DimensionStat[];
  guarantees: GuaranteeRate[];
  bestCall: BestCall | null;
  roughestMoment: RoughestMoment | null;
};

export function computeDigestStats(params: {
  periodStart: string;
  periodEnd: string;
  thisWeek: CallScoreRow[];
  lastWeek: CallScoreRow[];
}): DigestStats {
  const { periodStart, periodEnd, thisWeek, lastWeek } = params;
  return {
    periodStart,
    periodEnd,
    team: teamAverages(thisWeek),
    reps: repAverages(thisWeek, lastWeek),
    lowestDimensions: lowestDimensions(thisWeek),
    guarantees: guaranteeSayRates(thisWeek),
    bestCall: bestCall(thisWeek),
    roughestMoment: roughestMoment(thisWeek),
  };
}
