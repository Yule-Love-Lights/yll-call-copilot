// Coverage for resolvePromisedAt -- the anchor-to-call-date requirement
// (#217 DONE criterion 5): a "3-ish" promise must resolve to 15:00
// America/New_York on the CALL's date, never on "now" (extraction runs
// 45-75 minutes after the call).

import { describe, it, expect } from 'vitest';
import { resolvePromisedAt } from './time';

describe('resolvePromisedAt', () => {
  it('resolves "3pm" to 15:00 America/New_York on the call date (EST, UTC-5)', () => {
    // 2026-01-15T18:30:00Z = 2026-01-15 13:30 EST -- January, standard time.
    const calledAt = '2026-01-15T18:30:00Z';
    const result = resolvePromisedAt(calledAt, '15:00', 0);
    // 15:00 EST = 20:00 UTC.
    expect(result).toBe('2026-01-15T20:00:00.000Z');
  });

  it('resolves correctly in EDT (UTC-4, daylight saving)', () => {
    // 2026-07-15T15:00:00Z = 2026-07-15 11:00 EDT -- July, daylight time.
    const calledAt = '2026-07-15T15:00:00Z';
    const result = resolvePromisedAt(calledAt, '15:00', 0);
    // 15:00 EDT = 19:00 UTC.
    expect(result).toBe('2026-07-15T19:00:00.000Z');
  });

  it('anchors to the CALL date, not extraction time -- a late-night call promise stays on the call day even though extraction runs the next calendar day', () => {
    // 2026-01-15T04:00:00Z = 2026-01-14 23:00 EST -- the call happened on
    // Jan 14 local time, even though its UTC timestamp reads Jan 15.
    // Extraction (this test standing in for "now") runs well after
    // midnight local, on what would read as Jan 15 in NY -- resolving off
    // "now" would put this promise on the wrong day.
    const calledAt = '2026-01-15T04:00:00Z';
    const result = resolvePromisedAt(calledAt, '22:00', 0);
    // 22:00 EST on Jan 14 = 2026-01-15T03:00:00Z.
    expect(result).toBe('2026-01-15T03:00:00.000Z');
  });

  it('applies promised_day_offset for "tomorrow" promises', () => {
    const calledAt = '2026-01-15T18:30:00Z'; // Jan 15 EST
    const result = resolvePromisedAt(calledAt, '09:00', 1); // tomorrow, 9am
    expect(result).toBe('2026-01-16T14:00:00.000Z'); // 09:00 EST Jan 16 = 14:00 UTC
  });

  it('returns null when no specific time was mentioned', () => {
    expect(resolvePromisedAt('2026-01-15T18:30:00Z', null, null)).toBeNull();
  });

  it('returns null when calledAt is missing', () => {
    expect(resolvePromisedAt(null, '15:00', 0)).toBeNull();
  });

  it('returns null on a malformed time string rather than throwing', () => {
    expect(resolvePromisedAt('2026-01-15T18:30:00Z', 'not-a-time', 0)).toBeNull();
  });

  it('treats a null day offset as same-day (0)', () => {
    const withNull = resolvePromisedAt('2026-01-15T18:30:00Z', '15:00', null);
    const withZero = resolvePromisedAt('2026-01-15T18:30:00Z', '15:00', 0);
    expect(withNull).toBe(withZero);
  });
});
