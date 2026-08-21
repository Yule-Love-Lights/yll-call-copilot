import { describe, expect, it } from 'vitest';
import {
  isConfirmedUnbannedQuoteToolUser,
  normalizeOperatorEmail,
  selectExactlyOneActiveHubEmployee,
} from './quote-tool-identity-logic.mjs';

const now = new Date('2026-08-21T12:00:00.000Z');
const email = 'office.user@example.test';

describe('Quote Tool identity bridge operator checks', () => {
  it('normalizes only usable operator email input', () => {
    expect(normalizeOperatorEmail(' Office.User@Example.Test ')).toBe(email);
    expect(normalizeOperatorEmail('not-an-email')).toBeNull();
    expect(normalizeOperatorEmail(undefined)).toBeNull();
  });

  it('requires the exact confirmed, unbanned Quote Tool user', () => {
    const user = {
      id: '92000000-0000-4000-8000-000000000001',
      email: 'Office.User@Example.Test',
      email_confirmed_at: '2026-08-20T12:00:00.000Z',
      banned_until: null,
    };

    expect(isConfirmedUnbannedQuoteToolUser(user, email, now)).toBe(true);
    expect(isConfirmedUnbannedQuoteToolUser({ ...user, email_confirmed_at: null }, email, now)).toBe(false);
    expect(isConfirmedUnbannedQuoteToolUser({ ...user, banned_until: '2026-08-22T12:00:00.000Z' }, email, now)).toBe(false);
    expect(isConfirmedUnbannedQuoteToolUser({ ...user, email: 'other@example.test' }, email, now)).toBe(false);
  });

  it('refuses ambiguous, inactive, or mismatched Hub employee lookups', () => {
    const employee = {
      id: '91000000-0000-4000-8000-000000000001',
      active: true,
      compatibility_email: email,
    };

    expect(selectExactlyOneActiveHubEmployee([employee], email)).toEqual(employee);
    expect(selectExactlyOneActiveHubEmployee([employee, { ...employee, id: '91000000-0000-4000-8000-000000000002' }], email)).toBeNull();
    expect(selectExactlyOneActiveHubEmployee([{ ...employee, active: false }], email)).toBeNull();
    expect(selectExactlyOneActiveHubEmployee([{ ...employee, compatibility_email: 'other@example.test' }], email)).toBeNull();
  });
});
