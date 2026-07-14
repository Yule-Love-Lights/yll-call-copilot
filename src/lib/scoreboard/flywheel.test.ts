import { describe, it, expect } from 'vitest';
import { normalizePhone, normalizeEmail, computeRebookRate, rebookRateMetric, type RebookQuoteRow } from './flywheel';

describe('normalizePhone', () => {
  it('normalizes a plain 10-digit US number to E.164', () => {
    expect(normalizePhone('516-555-1234')).toBe('+15165551234');
  });

  it('normalizes a number already carrying a leading 1', () => {
    expect(normalizePhone('1 (516) 555-1234')).toBe('+15165551234');
  });

  it('normalizes a number already in E.164', () => {
    expect(normalizePhone('+15165551234')).toBe('+15165551234');
  });

  it('treats differently-formatted versions of the same number as identical', () => {
    expect(normalizePhone('(516) 555-1234')).toBe(normalizePhone('5165551234'));
    expect(normalizePhone('5165551234')).toBe(normalizePhone('+1-516-555-1234'));
  });

  it('returns null for an unrecognizable digit count', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Jane@Example.COM ')).toBe('jane@example.com');
  });

  it('returns null for blank/missing', () => {
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

const ASOF = new Date('2026-07-14T12:00:00.000Z'); // thisSeasonYear = 2026, priorSeasonYear = 2025

function q(overrides: Partial<RebookQuoteRow> = {}): RebookQuoteRow {
  return {
    phone: '516-555-1234',
    email: 'jane@example.com',
    approvedAt: '2025-11-01T00:00:00.000Z',
    isTest: false,
    ...overrides,
  };
}

describe('computeRebookRate', () => {
  it('returns null rate when there were zero approved quotes last season', () => {
    const result = computeRebookRate([], ASOF);
    expect(result).toEqual({ priorSeasonCustomers: 0, rebookedCustomers: 0, rate: null });
  });

  it('counts a customer as rebooked when the SAME phone appears in both seasons, formatted differently', () => {
    const rows = [
      q({ phone: '(516) 555-1234', approvedAt: '2025-11-01T00:00:00.000Z' }),
      q({ phone: '516.555.1234', email: null, approvedAt: '2026-06-01T00:00:00.000Z' }),
    ];
    const result = computeRebookRate(rows, ASOF);
    expect(result).toEqual({ priorSeasonCustomers: 1, rebookedCustomers: 1, rate: 100 });
  });

  it('matches on email when phone is missing from one of the two quotes', () => {
    const rows = [
      q({ phone: null, email: 'jane@example.com', approvedAt: '2025-11-01T00:00:00.000Z' }),
      q({ phone: null, email: 'JANE@EXAMPLE.COM', approvedAt: '2026-06-01T00:00:00.000Z' }),
    ];
    const result = computeRebookRate(rows, ASOF);
    expect(result.rebookedCustomers).toBe(1);
  });

  it('does not double count a customer with two quotes in the same prior season', () => {
    const rows = [
      q({ approvedAt: '2025-10-01T00:00:00.000Z' }),
      q({ approvedAt: '2025-11-15T00:00:00.000Z' }), // same phone+email, same season
    ];
    const result = computeRebookRate(rows, ASOF);
    expect(result.priorSeasonCustomers).toBe(1);
  });

  it('a prior-season customer who did not return this season is not counted as rebooked', () => {
    const rows = [q({ approvedAt: '2025-11-01T00:00:00.000Z' })];
    const result = computeRebookRate(rows, ASOF);
    expect(result).toEqual({ priorSeasonCustomers: 1, rebookedCustomers: 0, rate: 0 });
  });

  it('excludes is_test rows from both seasons', () => {
    const rows = [
      q({ approvedAt: '2025-11-01T00:00:00.000Z', isTest: true }),
      q({ phone: '516-555-9999', email: 'other@example.com', approvedAt: '2025-11-05T00:00:00.000Z' }),
    ];
    const result = computeRebookRate(rows, ASOF);
    expect(result.priorSeasonCustomers).toBe(1);
  });

  it('a row with neither a matchable phone nor email is ignored, not crashed on', () => {
    const rows = [q({ phone: 'not-a-phone', email: null })];
    const result = computeRebookRate(rows, ASOF);
    expect(result.priorSeasonCustomers).toBe(0);
  });
});

describe('rebookRateMetric', () => {
  it('reports not_connected when there is no prior-season baseline yet', () => {
    const metric = rebookRateMetric([], ASOF);
    expect(metric.status).toBe('not_connected');
  });

  it('reports a connected value with a human-readable detail', () => {
    const rows = [
      q({ approvedAt: '2025-11-01T00:00:00.000Z' }),
      q({ approvedAt: '2026-06-01T00:00:00.000Z' }),
    ];
    const metric = rebookRateMetric(rows, ASOF);
    expect(metric.status).toBe('connected');
    if (metric.status === 'connected') {
      expect(metric.value).toBe(100);
      expect(metric.detail).toContain('1 of 1');
    }
  });
});
