// Pure aggregation over call_scores rows (0008) for the transparency
// scoreboard (docs/SALES-EXCELLENCE-PLAN.md "Visibility" + "two wall
// metrics" blocks). No I/O here — the route does the Supabase fetch and
// hands rows in; this file is the part worth testing hard (same split as
// src/lib/analytics/stats.ts's computeStats/loadStats).
//
// CallScoreRow is deliberately a NARROW, board-safe shape: it carries only
// scores, dimension scores, the win text, and the call timestamp. It has no
// `fix` field and no per-dimension `notes` at all — rule 3 of the locked
// visibility rules ("scores are public but corrections are one-on-one, the
// board never shows fixes or rough moments") is enforced structurally here,
// not by remembering to omit a field at render time.

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export type DimScore = { score: number; max: number };

export type CallScoreRow = {
  // Nullable for real: historical imports and calls whose GHL user had no
  // email are scored with rep_email null. They count in team averages but
  // can never be a board row (see buildScoreboard).
  repEmail: string | null;
  overall: number; // 0-100
  experienceScore: number; // 0-10
  sales: {
    opening: DimScore;
    discovery: DimScore;
    value: DimScore;
    objections: DimScore;
    close: DimScore;
  };
  hospitality: {
    greeting: DimScore;
    listening: DimScore;
    courtesy: DimScore;
    deadAir: DimScore;
    warmEnding: DimScore;
  };
  win: string;
  calledAt: string; // ISO timestamp
};

type DimensionKey =
  | 'opening'
  | 'discovery'
  | 'value'
  | 'objections'
  | 'close'
  | 'greeting'
  | 'listening'
  | 'courtesy'
  | 'deadAir'
  | 'warmEnding';

const DIMENSION_KEYS: readonly DimensionKey[] = [
  'opening',
  'discovery',
  'value',
  'objections',
  'close',
  'greeting',
  'listening',
  'courtesy',
  'deadAir',
  'warmEnding',
];

function dimScore(row: CallScoreRow, key: DimensionKey): DimScore {
  switch (key) {
    case 'opening': return row.sales.opening;
    case 'discovery': return row.sales.discovery;
    case 'value': return row.sales.value;
    case 'objections': return row.sales.objections;
    case 'close': return row.sales.close;
    case 'greeting': return row.hospitality.greeting;
    case 'listening': return row.hospitality.listening;
    case 'courtesy': return row.hospitality.courtesy;
    case 'deadAir': return row.hospitality.deadAir;
    case 'warmEnding': return row.hospitality.warmEnding;
  }
}

export type DimensionAverage = { key: DimensionKey; avgScore: number; avgMax: number };
export type TrendPoint = { weekStart: string; weekEnd: string; avgOverall: number | null; calls: number };

export type RepStat = {
  repEmail: string;
  callsScored: number; // this week
  avgOverall: number | null; // this week; null when callsScored === 0
  avgExperience: number | null; // this week
  perDimension: DimensionAverage[]; // this week; [] when callsScored === 0
  trend: TrendPoint[]; // 4 points, oldest first, last entry is this week
  improvementDelta: number | null; // this week avg - rep's own prior-4-week avg; null if either side has no calls
  bestWin: string | null; // win text of this week's highest-overall call; null when callsScored === 0
};

export type TeamAverages = { avgOverall: number | null; avgExperience: number | null; callsScored: number };

export type ScoreboardData = {
  asOf: string;
  // Sorted by improvementDelta descending; reps with no delta (no calls this
  // week, or no prior-4-week baseline) sort after every rep with a real
  // delta, alphabetically among themselves. Encodes rule 2 (trend celebrated
  // as loudly as the top score) at the DATA level, not just in the UI.
  mostImproved: RepStat[];
  // Sorted by this week's avgOverall descending; reps with no calls this
  // week sort after every scored rep, alphabetically among themselves.
  topScore: RepStat[];
  teamAverages: TeamAverages;
};

// ─── Pure helpers ────────────────────────────────────────────────────────

export function average(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// The trailing 7-day window `weeksAgo` weeks back from asOf. weeksAgo=0 is
// "this week": [asOf-7d, asOf], both ends inclusive (asOf is "now" — a call
// landing at this exact instant should count). Every older window is
// [start, end) — end EXCLUSIVE — so a call sitting exactly on the boundary
// between two windows is claimed by the more recent one only, never both.
export function weekWindow(asOf: Date, weeksAgo: number): { startMs: number; endMs: number; endInclusive: boolean } {
  const endMs = asOf.getTime() - weeksAgo * WEEK_MS;
  const startMs = endMs - WEEK_MS;
  return { startMs, endMs, endInclusive: weeksAgo === 0 };
}

function inWindow(calledAtMs: number, win: { startMs: number; endMs: number; endInclusive: boolean }): boolean {
  if (calledAtMs < win.startMs) return false;
  return win.endInclusive ? calledAtMs <= win.endMs : calledAtMs < win.endMs;
}

function rowsInWindow(rows: CallScoreRow[], repEmail: string, win: { startMs: number; endMs: number; endInclusive: boolean }): CallScoreRow[] {
  return rows.filter(r => r.repEmail === repEmail && inWindow(new Date(r.calledAt).getTime(), win));
}

// ─── Per-rep aggregation ────────────────────────────────────────────────

function computeTrend(rows: CallScoreRow[], repEmail: string, asOf: Date, weeks = 4): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (let weeksAgo = weeks - 1; weeksAgo >= 0; weeksAgo--) {
    const win = weekWindow(asOf, weeksAgo);
    const weekRows = rowsInWindow(rows, repEmail, win);
    points.push({
      weekStart: new Date(win.startMs).toISOString(),
      weekEnd: new Date(win.endMs).toISOString(),
      avgOverall: average(weekRows.map(r => r.overall)),
      calls: weekRows.length,
    });
  }
  return points;
}

function computePerDimension(rows: CallScoreRow[]): DimensionAverage[] {
  if (rows.length === 0) return [];
  return DIMENSION_KEYS.map(key => {
    const scores = rows.map(r => dimScore(r, key));
    return {
      key,
      avgScore: round1(average(scores.map(s => s.score)) ?? 0),
      avgMax: round1(average(scores.map(s => s.max)) ?? 0),
    };
  });
}

function computeBestWin(rows: CallScoreRow[]): string | null {
  if (rows.length === 0) return null;
  const best = rows.reduce((top, r) => {
    if (r.overall > top.overall) return r;
    if (r.overall === top.overall && new Date(r.calledAt).getTime() < new Date(top.calledAt).getTime()) return r;
    return top;
  });
  return best.win;
}

// Rep's own prior-4-week baseline: the 28-day window immediately before this
// week (weeksAgo 1 through 4 combined), used only for the improvement delta
// — separate from the 4-point `trend` series above, which includes THIS
// week as its most recent point.
function priorBaselineWindow(asOf: Date): { startMs: number; endMs: number; endInclusive: boolean } {
  const thisWeek = weekWindow(asOf, 0);
  return { startMs: thisWeek.startMs - 4 * WEEK_MS, endMs: thisWeek.startMs, endInclusive: false };
}

export function buildRepStat(repEmail: string, rows: CallScoreRow[], asOf: Date): RepStat {
  const thisWeekRows = rowsInWindow(rows, repEmail, weekWindow(asOf, 0));
  const priorRows = rowsInWindow(rows, repEmail, priorBaselineWindow(asOf));

  const currentAvg = average(thisWeekRows.map(r => r.overall));
  const priorAvg = average(priorRows.map(r => r.overall));
  const improvementDelta = currentAvg !== null && priorAvg !== null ? round1(currentAvg - priorAvg) : null;

  const avgExperienceRaw = average(thisWeekRows.map(r => r.experienceScore));

  return {
    repEmail,
    callsScored: thisWeekRows.length,
    avgOverall: currentAvg !== null ? round1(currentAvg) : null,
    avgExperience: avgExperienceRaw !== null ? round1(avgExperienceRaw) : null,
    perDimension: computePerDimension(thisWeekRows),
    trend: computeTrend(rows, repEmail, asOf),
    improvementDelta,
    bestWin: computeBestWin(thisWeekRows),
  };
}

// ─── Board assembly ──────────────────────────────────────────────────────

// Every rep who appears anywhere in `rows` gets a row, even a rep with zero
// calls THIS week (their prior history still earned them a place — rule 1,
// Naldo's own calls included, means this must never special-case anyone
// out). A rep with literally zero rows ever simply isn't knowable from this
// input; the route is responsible for deciding whether to also merge in a
// roster of reps who have never been scored at all.
// Rows with rep_email null (unattributed historical calls) stay in the
// team averages below but never become a board row — a null here crashed
// the whole endpoint on first contact with real data (localeCompare on
// null in the sorters).
export function buildScoreboard(rows: CallScoreRow[], asOf: Date): ScoreboardData {
  const repEmails = [...new Set(rows.map(r => r.repEmail).filter((e): e is string => e !== null))].sort();
  const repStats = repEmails.map(email => buildRepStat(email, rows, asOf));

  const mostImproved = [...repStats].sort((a, b) => {
    if (a.improvementDelta !== null && b.improvementDelta !== null) {
      if (a.improvementDelta !== b.improvementDelta) return b.improvementDelta - a.improvementDelta;
      return a.repEmail.localeCompare(b.repEmail);
    }
    if (a.improvementDelta !== null) return -1; // a has a real delta, b doesn't — a ranks first
    if (b.improvementDelta !== null) return 1;
    return a.repEmail.localeCompare(b.repEmail);
  });

  const topScore = [...repStats].sort((a, b) => {
    if (a.avgOverall !== null && b.avgOverall !== null) {
      if (a.avgOverall !== b.avgOverall) return b.avgOverall - a.avgOverall;
      return a.repEmail.localeCompare(b.repEmail);
    }
    if (a.avgOverall !== null) return -1;
    if (b.avgOverall !== null) return 1;
    return a.repEmail.localeCompare(b.repEmail);
  });

  const thisWeekAllRows = rows.filter(r => inWindow(new Date(r.calledAt).getTime(), weekWindow(asOf, 0)));
  const teamAvgOverall = average(thisWeekAllRows.map(r => r.overall));
  const teamAvgExperience = average(thisWeekAllRows.map(r => r.experienceScore));

  return {
    asOf: asOf.toISOString(),
    mostImproved,
    topScore,
    teamAverages: {
      avgOverall: teamAvgOverall !== null ? round1(teamAvgOverall) : null,
      avgExperience: teamAvgExperience !== null ? round1(teamAvgExperience) : null,
      callsScored: thisWeekAllRows.length,
    },
  };
}
