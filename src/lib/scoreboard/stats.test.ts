import { describe, it, expect } from 'vitest';
import { average, weekWindow, buildRepStat, buildScoreboard, type CallScoreRow } from './stats';

const ASOF = new Date('2026-07-14T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function dim(score: number, max = 10): { score: number; max: number } {
  return { score, max };
}

function row(overrides: Partial<CallScoreRow> = {}): CallScoreRow {
  return {
    repEmail: 'jason@example.com',
    overall: 80,
    experienceScore: 8,
    sales: {
      opening: dim(3, 3),
      discovery: dim(4, 5),
      value: dim(4, 5),
      objections: dim(3, 4),
      close: dim(3, 4),
    },
    hospitality: {
      greeting: dim(2, 2),
      listening: dim(2, 2),
      courtesy: dim(2, 2),
      deadAir: dim(2, 2),
      warmEnding: dim(2, 2),
    },
    win: 'Named the referral credit unprompted.',
    calledAt: ASOF.toISOString(),
    ...overrides,
  };
}

function isoAt(msFromAsOf: number): string {
  return new Date(ASOF.getTime() + msFromAsOf).toISOString();
}

describe('average', () => {
  it('returns null for an empty array, not NaN', () => {
    expect(average([])).toBeNull();
  });

  it('averages a normal array', () => {
    expect(average([1, 2, 3])).toBe(2);
  });
});

describe('weekWindow', () => {
  it('this week (weeksAgo=0) is [asOf-7d, asOf] inclusive on both ends', () => {
    const win = weekWindow(ASOF, 0);
    expect(win.startMs).toBe(ASOF.getTime() - WEEK_MS);
    expect(win.endMs).toBe(ASOF.getTime());
    expect(win.endInclusive).toBe(true);
  });

  it('an older week is end-exclusive', () => {
    const win = weekWindow(ASOF, 1);
    expect(win.endInclusive).toBe(false);
  });
});

describe('buildRepStat — window boundaries', () => {
  it('a call at exactly asOf-7d belongs to this week, not the prior window', () => {
    const boundaryRow = row({ calledAt: isoAt(-WEEK_MS), overall: 90 });
    const stat = buildRepStat('jason@example.com', [boundaryRow], ASOF);
    expect(stat.callsScored).toBe(1);
    expect(stat.avgOverall).toBe(90);
    // No prior-window calls at all -> no baseline -> delta null, not NaN.
    expect(stat.improvementDelta).toBeNull();
  });

  it('a call at exactly asOf-35d is included in the prior 4-week baseline', () => {
    const thisWeekRow = row({ calledAt: isoAt(0), overall: 80 });
    const priorBoundaryRow = row({ calledAt: isoAt(-5 * WEEK_MS), overall: 60 });
    const stat = buildRepStat('jason@example.com', [thisWeekRow, priorBoundaryRow], ASOF);
    expect(stat.improvementDelta).toBe(20); // 80 - 60
  });

  it('a call 1ms older than asOf-35d falls outside the prior baseline', () => {
    const thisWeekRow = row({ calledAt: isoAt(0), overall: 80 });
    const tooOldRow = row({ calledAt: isoAt(-5 * WEEK_MS - 1), overall: 10 });
    const stat = buildRepStat('jason@example.com', [thisWeekRow, tooOldRow], ASOF);
    // The too-old call must not pull the baseline down — no baseline at all.
    expect(stat.improvementDelta).toBeNull();
  });
});

describe('buildRepStat — improvement delta', () => {
  it('is null for a brand new rep with no calls before this week (no baseline)', () => {
    const stat = buildRepStat('new@example.com', [row({ repEmail: 'new@example.com', calledAt: isoAt(0) })], ASOF);
    expect(stat.improvementDelta).toBeNull();
  });

  it('is null when the rep has prior history but zero calls this week', () => {
    const priorOnly = row({ calledAt: isoAt(-2 * WEEK_MS), overall: 70 });
    const stat = buildRepStat('jason@example.com', [priorOnly], ASOF);
    expect(stat.callsScored).toBe(0);
    expect(stat.avgOverall).toBeNull();
    expect(stat.improvementDelta).toBeNull();
  });

  it('computes a positive delta when this week beats the 4-week baseline', () => {
    const rows = [
      row({ calledAt: isoAt(0), overall: 90 }),
      row({ calledAt: isoAt(-2 * WEEK_MS), overall: 60 }),
      row({ calledAt: isoAt(-3 * WEEK_MS), overall: 70 }),
    ];
    const stat = buildRepStat('jason@example.com', rows, ASOF);
    expect(stat.improvementDelta).toBe(25); // 90 - avg(60,70)=65
  });
});

describe('buildRepStat — dimensions and best win', () => {
  it('averages per-dimension scores across this week only', () => {
    const rows = [
      row({ calledAt: isoAt(0), sales: { opening: dim(3, 3), discovery: dim(5, 5), value: dim(5, 5), objections: dim(4, 4), close: dim(4, 4) } }),
      row({ calledAt: isoAt(-1), sales: { opening: dim(1, 3), discovery: dim(3, 5), value: dim(3, 5), objections: dim(2, 4), close: dim(2, 4) } }),
    ];
    const stat = buildRepStat('jason@example.com', rows, ASOF);
    const opening = stat.perDimension.find(d => d.key === 'opening');
    expect(opening?.avgScore).toBe(2); // (3+1)/2
  });

  it('picks the win text of the highest-overall call this week', () => {
    const rows = [
      row({ calledAt: isoAt(0), overall: 70, win: 'ok call' }),
      row({ calledAt: isoAt(-1), overall: 95, win: 'best call' }),
    ];
    const stat = buildRepStat('jason@example.com', rows, ASOF);
    expect(stat.bestWin).toBe('best call');
  });

  it('bestWin and perDimension are null/empty with zero calls this week', () => {
    const stat = buildRepStat('nobody@example.com', [], ASOF);
    expect(stat.bestWin).toBeNull();
    expect(stat.perDimension).toEqual([]);
  });
});

describe('buildScoreboard', () => {
  it('handles zero rows without crashing', () => {
    const board = buildScoreboard([], ASOF);
    expect(board.mostImproved).toEqual([]);
    expect(board.topScore).toEqual([]);
    expect(board.teamAverages).toEqual({ avgOverall: null, avgExperience: null, callsScored: 0 });
  });

  it('keeps unattributed (null rep) calls in team averages but off the board', () => {
    // Regression: a null rep_email (historical imports) crashed the whole
    // endpoint via localeCompare(null) on first contact with real data.
    const rows = [
      row({ repEmail: 'jamie@example.com', calledAt: isoAt(0), overall: 80 }),
      row({ repEmail: null, calledAt: isoAt(0), overall: 40 }),
    ];
    const board = buildScoreboard(rows, ASOF);
    expect(board.topScore.map(r => r.repEmail)).toEqual(['jamie@example.com']);
    expect(board.mostImproved.map(r => r.repEmail)).toEqual(['jamie@example.com']);
    expect(board.teamAverages.callsScored).toBe(2);
    expect(board.teamAverages.avgOverall).toBe(60);
  });

  it('ranks most-improved by delta descending, then alphabetically', () => {
    const rows = [
      // jason: +20
      row({ repEmail: 'jason@example.com', calledAt: isoAt(0), overall: 90 }),
      row({ repEmail: 'jason@example.com', calledAt: isoAt(-2 * WEEK_MS), overall: 70 }),
      // naldo: +5
      row({ repEmail: 'naldo@example.com', calledAt: isoAt(0), overall: 75 }),
      row({ repEmail: 'naldo@example.com', calledAt: isoAt(-2 * WEEK_MS), overall: 70 }),
    ];
    const board = buildScoreboard(rows, ASOF);
    expect(board.mostImproved.map(r => r.repEmail)).toEqual(['jason@example.com', 'naldo@example.com']);
  });

  it('places reps with no delta after every rep with a real delta', () => {
    const rows = [
      row({ repEmail: 'established@example.com', calledAt: isoAt(0), overall: 90 }),
      row({ repEmail: 'established@example.com', calledAt: isoAt(-2 * WEEK_MS), overall: 80 }),
      // brand-new rep: only a call this week, no baseline
      row({ repEmail: 'brandnew@example.com', calledAt: isoAt(0), overall: 99 }),
    ];
    const board = buildScoreboard(rows, ASOF);
    expect(board.mostImproved.map(r => r.repEmail)).toEqual(['established@example.com', 'brandnew@example.com']);
    // But the new rep still shows up in the top-score section on raw score.
    expect(board.topScore.map(r => r.repEmail)).toEqual(['brandnew@example.com', 'established@example.com']);
  });

  it('Naldo is just another row — no special-casing', () => {
    const rows = [
      row({ repEmail: 'naldo@example.com', calledAt: isoAt(0), overall: 55 }),
      row({ repEmail: 'jason@example.com', calledAt: isoAt(0), overall: 95 }),
    ];
    const board = buildScoreboard(rows, ASOF);
    expect(board.topScore.map(r => r.repEmail)).toEqual(['jason@example.com', 'naldo@example.com']);
    expect(board.mostImproved.some(r => r.repEmail === 'naldo@example.com')).toBe(true);
  });

  it('team averages cover this week across every rep combined', () => {
    const rows = [
      row({ repEmail: 'a@example.com', calledAt: isoAt(0), overall: 80, experienceScore: 8 }),
      row({ repEmail: 'b@example.com', calledAt: isoAt(0), overall: 60, experienceScore: 6 }),
      row({ repEmail: 'a@example.com', calledAt: isoAt(-2 * WEEK_MS), overall: 10, experienceScore: 1 }), // outside this week — excluded
    ];
    const board = buildScoreboard(rows, ASOF);
    expect(board.teamAverages).toEqual({ avgOverall: 70, avgExperience: 7, callsScored: 2 });
  });
});
