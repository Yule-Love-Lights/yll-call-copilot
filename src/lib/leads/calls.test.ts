// Coverage for validateCallInput — the "calls POST validation" pure function.

import { describe, it, expect } from 'vitest';
import { validateCallInput } from './calls';

describe('validateCallInput', () => {
  it('accepts a minimal valid body with no transcript', () => {
    const result = validateCallInput({ leadId: 'lead1', outcome: 'interested', notes: 'Wants a quote.' });
    expect(result).toEqual({
      valid: true,
      input: { leadId: 'lead1', outcome: 'interested', notes: 'Wants a quote.', transcript: null },
    });
  });

  it('trims and keeps a pasted transcript', () => {
    const result = validateCallInput({ leadId: 'lead1', outcome: 'voicemail', notes: '', transcript: '  hello  ' });
    expect(result).toEqual({ valid: true, input: { leadId: 'lead1', outcome: 'voicemail', notes: '', transcript: 'hello' } });
  });

  it('rejects a missing leadId', () => {
    const result = validateCallInput({ outcome: 'interested', notes: '' });
    expect(result).toEqual({ valid: false, error: 'leadId is required.' });
  });

  it('rejects a blank leadId', () => {
    const result = validateCallInput({ leadId: '   ', outcome: 'interested', notes: '' });
    expect(result.valid).toBe(false);
  });

  it('rejects a missing outcome', () => {
    const result = validateCallInput({ leadId: 'lead1', notes: '' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/outcome must be one of/);
  });

  it('rejects an outcome outside the allowed set', () => {
    const result = validateCallInput({ leadId: 'lead1', outcome: 'maybe_later', notes: '' });
    expect(result.valid).toBe(false);
  });

  it('rejects a non-object body', () => {
    expect(validateCallInput(null)).toEqual({ valid: false, error: 'Invalid request body.' });
    expect(validateCallInput('nope')).toEqual({ valid: false, error: 'Invalid request body.' });
  });

  it('defaults notes to an empty string when absent', () => {
    const result = validateCallInput({ leadId: 'lead1', outcome: 'no_answer' });
    expect(result).toEqual({ valid: true, input: { leadId: 'lead1', outcome: 'no_answer', notes: '', transcript: null } });
  });

  it('treats a blank transcript the same as no transcript', () => {
    const result = validateCallInput({ leadId: 'lead1', outcome: 'no_answer', transcript: '   ' });
    expect(result).toEqual({ valid: true, input: { leadId: 'lead1', outcome: 'no_answer', notes: '', transcript: null } });
  });
});
