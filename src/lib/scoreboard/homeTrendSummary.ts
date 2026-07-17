// Pure summary layer over stats.ts's 4-week TrendPoint series, for the home
// dashboard's "Your month" sparkline (src/app/page.tsx). Kept separate from
// stats.ts itself so this UI-shaped bar/headline logic doesn't mix into the
// board's own aggregation math -- same "pure helper, its own test" split the
// rest of this lib already follows (see average(), weekWindow()).

import type { TrendPoint } from './stats';

export type TrendBar = {
  heightPct: number; // 0-100, drives a CSS height style directly
  hasData: boolean; // false = that week had zero scored calls
};

export type HomeTrendSummary = {
  bars: TrendBar[]; // one per input TrendPoint, oldest first (last = this week)
  headline: string;
};

// A week with zero calls still gets a visible sliver, not a collapsed bar --
// an empty sparkline reads as broken, not "no data yet".
const MIN_HEIGHT_PCT = 6;

export function summarizeHomeTrend(trend: TrendPoint[]): HomeTrendSummary {
  const bars = trend.map(point => ({
    heightPct: point.avgOverall !== null ? Math.max(MIN_HEIGHT_PCT, Math.round(point.avgOverall)) : MIN_HEIGHT_PCT,
    hasData: point.avgOverall !== null,
  }));

  const scoredPoints = trend.filter(point => point.avgOverall !== null);
  let headline: string;
  if (scoredPoints.length === 0) {
    headline = 'No scored calls yet this month.';
  } else if (scoredPoints.length === 1) {
    headline = 'First scored week is in the books.';
  } else {
    const first = scoredPoints[0].avgOverall as number;
    const last = scoredPoints[scoredPoints.length - 1].avgOverall as number;
    if (last > first) headline = 'Trending up. Keep it going.';
    else if (last < first) headline = 'A dip this month. Next call resets it.';
    else headline = 'Holding steady this month.';
  }

  return { bars, headline };
}
