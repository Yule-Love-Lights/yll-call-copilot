import { describe, it, expect } from 'vitest';
import { resolveBoardScope, isOnboardingPromptDue } from './visibility';

describe('resolveBoardScope', () => {
  it('a rep sees only their own row while the board is private', () => {
    expect(resolveBoardScope('rep', false)).toBe('own');
  });

  it('a rep sees the whole board once it is team-visible', () => {
    expect(resolveBoardScope('rep', true)).toBe('all');
  });

  it('a non-rep role (owner) sees everything even while private', () => {
    expect(resolveBoardScope('owner', false)).toBe('all');
  });

  it('a non-rep role (admin) sees everything once team-visible', () => {
    expect(resolveBoardScope('admin', true)).toBe('all');
  });

  it('an unresolved role fails closed to the private scope while the board is off', () => {
    expect(resolveBoardScope(null, false)).toBe('own');
  });

  it('an unresolved role still sees everything once the board is on (the switch wins)', () => {
    expect(resolveBoardScope(null, true)).toBe('all');
  });
});

describe('isOnboardingPromptDue', () => {
  const asOf = new Date('2026-07-14T12:00:00.000Z');

  it('is false once the board is already team-visible', () => {
    expect(isOnboardingPromptDue('2026-06-01', true, asOf)).toBe(false);
  });

  it('is false with no onboarding start date on record', () => {
    expect(isOnboardingPromptDue(null, false, asOf)).toBe(false);
  });

  it('is false before 14 days have passed', () => {
    expect(isOnboardingPromptDue('2026-07-05', false, asOf)).toBe(false); // 9 days
  });

  it('is true at exactly 14 days', () => {
    expect(isOnboardingPromptDue('2026-06-30', false, asOf)).toBe(true); // 14 days
  });

  it('is true well past 14 days', () => {
    expect(isOnboardingPromptDue('2026-01-01', false, asOf)).toBe(true);
  });
});
