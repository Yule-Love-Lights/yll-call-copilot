// Coverage for the two overall-score formatters — glance surfaces (lists,
// boards, tiles) round to a whole number; detail surfaces keep the stored
// one-decimal value. See formatScore.ts for the pre-launch audit context.

import { describe, it, expect } from 'vitest';
import { formatOverallGlance, formatOverallExact } from './formatScore';

describe('formatOverallGlance', () => {
  it('rounds down when the decimal is under .5', () => {
    expect(formatOverallGlance(8.2)).toBe('8');
  });

  it('rounds up when the decimal is .5 or over', () => {
    expect(formatOverallGlance(8.5)).toBe('9');
  });

  it('leaves a whole number unchanged', () => {
    expect(formatOverallGlance(7)).toBe('7');
  });
});

describe('formatOverallExact', () => {
  it('keeps exactly one decimal place', () => {
    expect(formatOverallExact(8.166666)).toBe('8.2');
  });

  it('pads a whole number with .0', () => {
    expect(formatOverallExact(7)).toBe('7.0');
  });
});
