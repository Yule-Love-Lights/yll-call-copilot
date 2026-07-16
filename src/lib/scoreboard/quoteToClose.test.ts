import { describe, it, expect } from 'vitest';
import {
  computeQuoteToClose,
  computeQuoteToCloseByVertical,
  trailingWindow,
  seasonToDateWindow,
  buildQuoteToCloseSummary,
  type QuoteToCloseRow,
} from './quoteToClose';

const WINDOW = { startIso: '2026-06-01T00:00:00.000Z', endIso: '2026-06-30T23:59:59.999Z' };

function q(overrides: Partial<QuoteToCloseRow> = {}): QuoteToCloseRow {
  return {
    sentAt: '2026-06-15T00:00:00.000Z',
    approvedAt: '2026-06-20T00:00:00.000Z',
    vertical: 'holiday',
    isTest: false,
    ...overrides,
  };
}

describe('computeQuoteToClose', () => {
  it('returns null rate (not NaN) when zero quotes were sent in the window', () => {
    const result = computeQuoteToClose([], WINDOW);
    expect(result).toEqual({ sent: 0, approved: 0, rate: null });
  });

  it('returns null rate when quotes exist but none were sent in the window', () => {
    const rows = [q({ sentAt: null }), q({ sentAt: '2026-05-01T00:00:00.000Z' })];
    const result = computeQuoteToClose(rows, WINDOW);
    expect(result).toEqual({ sent: 0, approved: 0, rate: null });
  });

  it('computes 100% when every sent quote was approved', () => {
    const rows = [q(), q()];
    expect(computeQuoteToClose(rows, WINDOW)).toEqual({ sent: 2, approved: 2, rate: 100 });
  });

  it('computes a partial rate correctly', () => {
    const rows = [q(), q({ approvedAt: null }), q({ approvedAt: null })];
    expect(computeQuoteToClose(rows, WINDOW)).toEqual({ sent: 3, approved: 1, rate: 33.3 });
  });

  it('excludes is_test rows from both sent and approved counts', () => {
    const rows = [q(), q({ isTest: true, approvedAt: null })];
    expect(computeQuoteToClose(rows, WINDOW)).toEqual({ sent: 1, approved: 1, rate: 100 });
  });

  it('counts an approval that lands after the window as still closed (approval can trail the send)', () => {
    const rows = [q({ approvedAt: '2026-08-01T00:00:00.000Z' })];
    expect(computeQuoteToClose(rows, WINDOW)).toEqual({ sent: 1, approved: 1, rate: 100 });
  });

  it('window boundaries are inclusive on both ends', () => {
    const rows = [
      q({ sentAt: WINDOW.startIso }),
      q({ sentAt: WINDOW.endIso }),
      q({ sentAt: '2026-05-31T23:59:59.998Z' }), // 1ms before start
      q({ sentAt: '2026-07-01T00:00:00.000Z' }), // after end
    ];
    expect(computeQuoteToClose(rows, WINDOW).sent).toBe(2);
  });
});

describe('computeQuoteToCloseByVertical', () => {
  it('groups a null vertical under holiday, the Quote Tool legacy default', () => {
    const rows = [q({ vertical: null }), q({ vertical: 'permanent' })];
    const byVertical = computeQuoteToCloseByVertical(rows, WINDOW);
    expect(byVertical.holiday.sent).toBe(1);
    expect(byVertical.permanent.sent).toBe(1);
  });
});

describe('trailingWindow / seasonToDateWindow', () => {
  it('trailingWindow spans exactly N days ending at asOf', () => {
    const asOf = new Date('2026-07-14T12:00:00.000Z');
    const win = trailingWindow(asOf, 30);
    expect(win.endIso).toBe(asOf.toISOString());
    expect(new Date(win.startIso).getTime()).toBe(asOf.getTime() - 30 * 24 * 60 * 60 * 1000);
  });

  it('seasonToDateWindow starts Jan 1 of asOf year (calendar-year fallback)', () => {
    const asOf = new Date('2026-07-14T12:00:00.000Z');
    const win = seasonToDateWindow(asOf);
    expect(win.startIso).toBe('2026-01-01T00:00:00.000Z');
    expect(win.endIso).toBe(asOf.toISOString());
  });
});

describe('buildQuoteToCloseSummary', () => {
  it('handles zero rows without crashing', () => {
    const summary = buildQuoteToCloseSummary([], new Date('2026-07-14T12:00:00.000Z'));
    expect(summary.trailing30.overall.rate).toBeNull();
    expect(summary.seasonToDate.overall.rate).toBeNull();
  });
});
