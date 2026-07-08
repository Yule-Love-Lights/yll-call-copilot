import { describe, it, expect } from 'vitest';
import { validatePlaybook } from './validate';
import type { Playbook } from './types';

const goodPlaybook: Playbook = {
  icp: 'Homeowners with existing holiday lighting.',
  angles: ['Renewal', 'Referral'],
  openers: [{ label: 'Past customer', script: 'Hi, this is Yule Love Lights.' }],
  objections: [{ objection: 'price', response: 'I hear you, let me explain.' }],
  avoid: ['Never pressure a homeowner.'],
  voicemail: 'Hi, give us a call back, thanks.',
};

describe('validatePlaybook', () => {
  it('accepts a well-formed Playbook', () => {
    const result = validatePlaybook(goodPlaybook);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.playbook).toEqual(goodPlaybook);
    }
  });

  it('rejects a Playbook missing a required field', () => {
    const missingVoicemail: Partial<Playbook> = { ...goodPlaybook };
    delete missingVoicemail.voicemail;

    const result = validatePlaybook(missingVoicemail);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/voicemail/i);
    }
  });

  it('rejects a non-object value', () => {
    expect(validatePlaybook(null).valid).toBe(false);
    expect(validatePlaybook('not a playbook').valid).toBe(false);
    expect(validatePlaybook(42).valid).toBe(false);
  });

  it('rejects malformed nested items (an opener missing its script)', () => {
    const bad = { ...goodPlaybook, openers: [{ label: 'Past customer' }] };
    const result = validatePlaybook(bad);
    expect(result.valid).toBe(false);
  });

  it('rejects a non-array angles field', () => {
    const bad = { ...goodPlaybook, angles: 'not an array' };
    expect(validatePlaybook(bad).valid).toBe(false);
  });
});
