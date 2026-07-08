// Coverage for the TCPA calling-hours gate: the 8am/9pm boundary math, the
// null-timezone fallback to the company's own zone, and proof that a
// contact's OWN zone (not the server's, not UTC) drives the answer -- fixed
// UTC instants throughout so this never depends on the machine running it.

import { describe, it, expect } from 'vitest';
import { isWithinCallingHours } from './callingHours';

describe('isWithinCallingHours', () => {
  describe('America/New_York (company default), January (EST, UTC-5)', () => {
    it('is false one minute before 8am ET', () => {
      // 12:59 UTC - 5h = 07:59 ET
      expect(isWithinCallingHours('America/New_York', new Date('2026-01-15T12:59:00Z'))).toBe(false);
    });

    it('is true exactly at 8:00am ET (inclusive lower bound)', () => {
      // 13:00 UTC - 5h = 08:00 ET
      expect(isWithinCallingHours('America/New_York', new Date('2026-01-15T13:00:00Z'))).toBe(true);
    });

    it('is true at 8:59pm ET, just under the cutoff', () => {
      // 01:59 UTC (next day) - 5h wraps to 20:59 ET the prior day
      expect(isWithinCallingHours('America/New_York', new Date('2026-01-16T01:59:00Z'))).toBe(true);
    });

    it('is false exactly at 9:00pm ET (exclusive upper bound)', () => {
      // 02:00 UTC (next day) - 5h wraps to 21:00 ET the prior day
      expect(isWithinCallingHours('America/New_York', new Date('2026-01-16T02:00:00Z'))).toBe(false);
    });

    it('is false in the middle of the night (2am ET)', () => {
      expect(isWithinCallingHours('America/New_York', new Date('2026-01-15T07:00:00Z'))).toBe(false);
    });
  });

  describe('null/missing timezone falls back to the company zone (America/New_York)', () => {
    it('treats null the same as America/New_York', () => {
      expect(isWithinCallingHours(null, new Date('2026-01-15T12:59:00Z'))).toBe(false);
      expect(isWithinCallingHours(null, new Date('2026-01-15T13:00:00Z'))).toBe(true);
    });

    it('treats undefined the same as America/New_York', () => {
      expect(isWithinCallingHours(undefined, new Date('2026-01-15T13:00:00Z'))).toBe(true);
    });

    it('treats an empty string the same as America/New_York', () => {
      expect(isWithinCallingHours('', new Date('2026-01-15T13:00:00Z'))).toBe(true);
    });
  });

  describe('uses the CONTACT-local zone, not the server/company zone', () => {
    it('a contact in America/Los_Angeles is within hours while America/New_York (the fallback) is not, at the same instant', () => {
      // 04:59 UTC: 20:59 PST (within 8am-9pm) but 23:59 EST (well outside).
      const now = new Date('2026-01-16T04:59:00Z');
      expect(isWithinCallingHours('America/Los_Angeles', now)).toBe(true);
      expect(isWithinCallingHours(null, now)).toBe(false);
    });
  });

  describe('an unrecognized IANA zone string', () => {
    it('falls back to the company zone instead of throwing', () => {
      expect(() => isWithinCallingHours('Not/A_Real_Zone', new Date('2026-01-15T13:00:00Z'))).not.toThrow();
      expect(isWithinCallingHours('Not/A_Real_Zone', new Date('2026-01-15T13:00:00Z'))).toBe(true);
      expect(isWithinCallingHours('Not/A_Real_Zone', new Date('2026-01-15T12:59:00Z'))).toBe(false);
    });
  });
});
