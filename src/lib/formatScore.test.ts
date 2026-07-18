// Coverage for the one shared overall-score formatting rule (the pre-launch
// audit found three pages rounding "overall" three different ways): glance
// surfaces round to a whole number, detail surfaces keep the stored one
// decimal.

import { describe, it, expect } from 'vitest';
import { formatOverallGlance, formatOverallExact } from './formatScore';

describe('formatOverallGlance', () => {
  it('rounds to the nearest whole number', () => {
    expect(formatOverallGlance(82.3)).toBe('82');
    expect(formatOverallGlance(82.5)).toBe('83');
    expect(formatOverallGlance(82.4)).toBe('82');
  });

  it('passes a whole number through unchanged', () => {
    expect(formatOverallGlance(90)).toBe('90');
  });
});

describe('formatOverallExact', () => {
  it('keeps exactly one decimal place', () => {
    expect(formatOverallExact(82.3)).toBe('82.3');
  });

  it('pads a whole number with .0', () => {
    expect(formatOverallExact(90)).toBe('90.0');
  });

  it('rounds a longer decimal to one place', () => {
    expect(formatOverallExact(82.36)).toBe('82.4');
  });
});
