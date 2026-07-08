import { describe, it, expect } from 'vitest';
import { validatePlaybook } from './validate';
import type { Playbook } from './types';

// Covers all five mandated opener labels and all five mandated objection
// categories (see generate.ts's system prompt) so this fixture stays valid
// under the L3 coverage check added below — every other test in this file
// exercises a DIFFERENT malformation and shouldn't have to think about
// coverage at all.
const goodPlaybook: Playbook = {
  icp: 'Homeowners with existing holiday lighting.',
  angles: ['Renewal', 'Referral'],
  openers: [
    { label: 'Inbound follow-up', script: 'Hi, thanks for reaching out to Yule Love Lights.' },
    { label: 'Past customer', script: 'Hi, this is Yule Love Lights.' },
    { label: 'Quote follow-up', script: 'Hi, following up on the quote we sent.' },
    { label: 'Neighbor install / referral', script: 'Hi, we just finished an install down your street.' },
    { label: 'Cold', script: 'Hi, this is a local lighting company.' },
  ],
  objections: [
    { objection: 'price too high', response: 'I hear you, let me explain what is included.' },
    { objection: 'not interested', response: 'No problem, thanks for your time.' },
    { objection: 'email me info', response: 'Happy to, what is the best email?' },
    { objection: 'need to ask my spouse', response: 'Of course, when is a good time to follow up?' },
    { objection: 'bad timing', response: 'No worries, when would be better?' },
  ],
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

// L3: generate.ts's system prompt mandates exactly five opener labels and
// at least five objection categories, but nothing checked that the
// generated (or hand-edited) playbook actually covers them — a playbook
// with only 1 opener passed validation and saved as the active version
// with no warning, silently missing a mandated call scenario.
describe('validatePlaybook — required opener/objection coverage (L3)', () => {
  it('accepts a well-formed playbook covering all five openers and objection categories', () => {
    expect(validatePlaybook(goodPlaybook).valid).toBe(true);
  });

  it('rejects a playbook missing one of the five required opener labels', () => {
    const bad = { ...goodPlaybook, openers: goodPlaybook.openers.filter(o => o.label !== 'Quote follow-up') };
    const result = validatePlaybook(bad);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/quote follow-up/i);
  });

  it('rejects a playbook missing one of the five required objection categories', () => {
    const bad = { ...goodPlaybook, objections: goodPlaybook.objections.filter(o => o.objection !== 'bad timing') };
    const result = validatePlaybook(bad);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/timing/i);
  });

  it('accepts an opener label that merely contains the required label, case-insensitively', () => {
    const withVariant = {
      ...goodPlaybook,
      openers: goodPlaybook.openers.map(o => (o.label === 'Cold' ? { ...o, label: 'cold (true cold call)' } : o)),
    };
    expect(validatePlaybook(withVariant).valid).toBe(true);
  });

  it('rejects the old minimal fixture shape (1 opener, 1 objection) that used to pass before this check existed', () => {
    const minimal = {
      ...goodPlaybook,
      openers: [{ label: 'Past customer', script: 'Hi, this is Yule Love Lights.' }],
      objections: [{ objection: 'price', response: 'I hear you, let me explain.' }],
    };
    expect(validatePlaybook(minimal).valid).toBe(false);
  });
});
