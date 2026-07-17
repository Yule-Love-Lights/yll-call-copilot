// Coverage for summarizeHomeTrend's bar heights (always >= the minimum
// sliver, real scores pass through as-is) and its headline classification
// (no data / one week / rising / falling / flat).

import { describe, it, expect } from 'vitest';
import { summarizeHomeTrend } from './homeTrendSummary';
import type { TrendPoint } from './stats';

function point(avgOverall: number | null): TrendPoint {
  return {
    weekStart: '2026-01-01T00:00:00.000Z',
    weekEnd: '2026-01-08T00:00:00.000Z',
    avgOverall,
    calls: avgOverall === null ? 0 : 1,
  };
}

describe('summarizeHomeTrend', () => {
  it('gives every no-data week a visible sliver and flags it as no-data', () => {
    const summary = summarizeHomeTrend([point(null), point(null), point(null), point(null)]);
    expect(summary.bars).toHaveLength(4);
    expect(summary.bars.every(b => b.heightPct === 6 && !b.hasData)).toBe(true);
    expect(summary.headline).toBe('No scored calls yet this month.');
  });

  it('reads a rising trend as trending up, oldest first', () => {
    const summary = summarizeHomeTrend([point(null), point(60), point(70), point(85)]);
    expect(summary.bars[0]).toEqual({ heightPct: 6, hasData: false });
    expect(summary.bars[3]).toEqual({ heightPct: 85, hasData: true });
    expect(summary.headline).toBe('Trending up. Keep it going.');
  });

  it('reads a falling trend as a dip', () => {
    const summary = summarizeHomeTrend([point(90), point(80), point(75), point(60)]);
    expect(summary.headline).toBe('A dip this month. Next call resets it.');
  });

  it('calls a flat trend steady', () => {
    const summary = summarizeHomeTrend([point(70), point(70)]);
    expect(summary.headline).toBe('Holding steady this month.');
  });

  it('celebrates a first scored week alone', () => {
    const summary = summarizeHomeTrend([point(null), point(null), point(null), point(72)]);
    expect(summary.headline).toBe('First scored week is in the books.');
  });

  it('floors a low real score at the minimum sliver height, never below it', () => {
    const summary = summarizeHomeTrend([point(2)]);
    expect(summary.bars[0]).toEqual({ heightPct: 6, hasData: true });
  });
});
