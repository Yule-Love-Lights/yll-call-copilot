// Coverage for validateCallInput — the "calls POST validation" pure function.

import { describe, it, expect } from 'vitest';
import { validateCallInput } from './calls';

describe('validateCallInput', () => {
  it('accepts a minimal valid body with no transcript', () => {
    const result = validateCallInput({ leadId: 'lead1', outcome: 'interested', notes: 'Wants a quote.' });
    expect(result).toEqual({
      valid: true,
      input: { leadId: 'lead1', outcome: 'interested', notes: 'Wants a quote.', transcript: null, callId: null },
    });
  });

  it('trims and keeps a pasted transcript', () => {
    const result = validateCallInput({ leadId: 'lead1', outcome: 'voicemail', notes: '', transcript: '  hello  ' });
    expect(result).toEqual({
      valid: true,
      input: { leadId: 'lead1', outcome: 'voicemail', notes: '', transcript: 'hello', callId: null },
    });
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
    expect(result).toEqual({
      valid: true,
      input: { leadId: 'lead1', outcome: 'no_answer', notes: '', transcript: null, callId: null },
    });
  });

  it('treats a blank transcript the same as no transcript', () => {
    const result = validateCallInput({ leadId: 'lead1', outcome: 'no_answer', transcript: '   ' });
    expect(result).toEqual({
      valid: true,
      input: { leadId: 'lead1', outcome: 'no_answer', notes: '', transcript: null, callId: null },
    });
  });

  // callId — see POST /api/calls: when set, the route updates the call a
  // live-coached session already created instead of inserting a second one.
  describe('callId', () => {
    it('accepts a well-formed uuid', () => {
      const result = validateCallInput({
        leadId: 'lead1',
        outcome: 'interested',
        notes: '',
        callId: '11111111-2222-4333-8444-555555555555',
      });
      expect(result).toEqual({
        valid: true,
        input: {
          leadId: 'lead1',
          outcome: 'interested',
          notes: '',
          transcript: null,
          callId: '11111111-2222-4333-8444-555555555555',
        },
      });
    });

    it('treats a blank callId the same as no callId', () => {
      const result = validateCallInput({ leadId: 'lead1', outcome: 'interested', notes: '', callId: '   ' });
      expect(result).toEqual({
        valid: true,
        input: { leadId: 'lead1', outcome: 'interested', notes: '', transcript: null, callId: null },
      });
    });

    it('rejects a malformed callId', () => {
      const result = validateCallInput({ leadId: 'lead1', outcome: 'interested', notes: '', callId: 'not-a-uuid' });
      expect(result).toEqual({ valid: false, error: 'callId must be a valid id.' });
    });
  });
});
