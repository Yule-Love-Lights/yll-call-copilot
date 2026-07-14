// Coverage for the December 10-25 cookies+ornament window and the season
// year helper -- both read the wall-clock date in America/New_York (not the
// server's zone), same Intl.DateTimeFormat approach as
// src/lib/leads/callingHours.ts. Fixed UTC instants throughout so this never
// depends on the machine running it. December is EST (UTC-5), no DST to
// worry about in this window.

import { describe, it, expect } from 'vitest';
import { getSeasonYear, isWithinCookiesOrnamentWindow } from './decemberWindow';

describe('isWithinCookiesOrnamentWindow', () => {
  it('is false one minute before the window opens (Dec 9 23:59 ET)', () => {
    // Dec 10 04:59 UTC - 5h = Dec 9 23:59 ET
    expect(isWithinCookiesOrnamentWindow(new Date('2026-12-10T04:59:00Z'))).toBe(false);
  });

  it('is true at the exact opening instant (Dec 10 00:00 ET, inclusive lower bound)', () => {
    // Dec 10 05:00 UTC - 5h = Dec 10 00:00 ET
    expect(isWithinCookiesOrnamentWindow(new Date('2026-12-10T05:00:00Z'))).toBe(true);
  });

  it('is true in the middle of the window (Dec 18 noon ET)', () => {
    expect(isWithinCookiesOrnamentWindow(new Date('2026-12-18T17:00:00Z'))).toBe(true);
  });

  it('is true right up to the last instant of Dec 25 (inclusive upper bound)', () => {
    // Dec 26 04:59 UTC - 5h = Dec 25 23:59 ET
    expect(isWithinCookiesOrnamentWindow(new Date('2026-12-26T04:59:00Z'))).toBe(true);
  });

  it('is false the instant Dec 26 begins in ET', () => {
    // Dec 26 05:00 UTC - 5h = Dec 26 00:00 ET
    expect(isWithinCookiesOrnamentWindow(new Date('2026-12-26T05:00:00Z'))).toBe(false);
  });

  it('is false well outside December (e.g. a July date)', () => {
    expect(isWithinCookiesOrnamentWindow(new Date('2026-07-14T17:00:00Z'))).toBe(false);
  });

  it('is false in early December before the 10th', () => {
    expect(isWithinCookiesOrnamentWindow(new Date('2026-12-01T17:00:00Z'))).toBe(false);
  });

  it('uses the company zone, not the server zone -- a UTC instant that is Dec 26 UTC but still Dec 25 ET is true', () => {
    // 2026-12-26T02:00:00Z is Dec 26 in UTC but Dec 25 21:00 ET.
    expect(isWithinCookiesOrnamentWindow(new Date('2026-12-26T02:00:00Z'))).toBe(true);
  });
});

describe('getSeasonYear', () => {
  it('reads the ET calendar year, not the UTC year, near a year boundary', () => {
    // 2026-01-01T04:00:00Z - 5h = 2025-12-31 23:00 ET
    expect(getSeasonYear(new Date('2026-01-01T04:00:00Z'))).toBe(2025);
    // 2026-01-01T05:30:00Z - 5h = 2026-01-01 00:30 ET
    expect(getSeasonYear(new Date('2026-01-01T05:30:00Z'))).toBe(2026);
  });

  it('reads the plain ET year in the middle of the year', () => {
    expect(getSeasonYear(new Date('2026-07-14T17:00:00Z'))).toBe(2026);
  });
});
