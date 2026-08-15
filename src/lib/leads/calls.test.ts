import { describe, expect, it } from 'vitest';
import { validateCallInput } from './calls';

const LEAD_ID = '11111111-2222-4333-8444-555555555555';
const SESSION_ID = '21111111-2222-4333-8444-555555555555';
const REQUEST_ID = '31111111-2222-4333-8444-555555555555';

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    leadId: LEAD_ID,
    outcome: 'interested',
    notes: 'Wants a quote.',
    completionRequestId: REQUEST_ID,
    ...overrides,
  };
}

describe('validateCallInput', () => {
  it('accepts and normalizes a manual completion', () => {
    expect(validateCallInput(validBody({ transcript: '  hello  ' }))).toEqual({
      valid: true,
      input: {
        leadId: LEAD_ID,
        outcome: 'interested',
        notes: 'Wants a quote.',
        transcript: 'hello',
        sessionId: null,
        completionRequestId: REQUEST_ID,
      },
    });
  });

  it('accepts the server-recovered live call id', () => {
    const result = validateCallInput(validBody({ sessionId: SESSION_ID, transcript: '   ' }));
    expect(result).toEqual({
      valid: true,
      input: {
        leadId: LEAD_ID,
        outcome: 'interested',
        notes: 'Wants a quote.',
        transcript: null,
        sessionId: SESSION_ID,
        completionRequestId: REQUEST_ID,
      },
    });
  });

  it.each([
    [null, 'Invalid request body.'],
    [validBody({ leadId: '' }), 'leadId is required.'],
    [validBody({ leadId: 'not-a-uuid' }), 'leadId must be a valid id.'],
    [validBody({ outcome: 'maybe' }), 'outcome must be one of:'],
    [validBody({ sessionId: 'not-a-uuid' }), 'sessionId must be a valid id.'],
    [validBody({ completionRequestId: '' }), 'completionRequestId must be a valid id.'],
  ])('rejects invalid input %#', (body, message) => {
    const result = validateCallInput(body);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain(message);
  });

  it('defaults optional text fields without accepting caller-owned direction', () => {
    const result = validateCallInput({
      leadId: LEAD_ID,
      outcome: 'no_answer',
      completionRequestId: REQUEST_ID,
      direction: 'inbound',
    });
    expect(result).toEqual({
      valid: true,
      input: {
        leadId: LEAD_ID,
        outcome: 'no_answer',
        notes: '',
        transcript: null,
        sessionId: null,
        completionRequestId: REQUEST_ID,
      },
    });
  });
});
