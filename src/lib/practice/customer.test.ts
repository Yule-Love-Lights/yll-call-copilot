import { describe, expect, it } from 'vitest';
import { buildCustomerSystemPrompt, type EmotionalState } from './customer';
import type { OfferElement } from '../scoring/types';

const NO_OFFER: OfferElement[] = [];

describe('buildCustomerSystemPrompt', () => {
  it('always instructs the model to stay in character as a real customer, never an AI assistant', () => {
    const prompt = buildCustomerSystemPrompt({ playbook: null, emotionalState: 'excited', offer: NO_OFFER });

    expect(prompt).toContain('NOT an AI assistant');
    expect(prompt).toContain('Never break character');
    // The prompt itself instructs the model never to use these words -- it
    // must name them to forbid them (same as scoring/score.ts's
    // buildSystemPrompt) -- so this checks the instruction is present, not
    // that the words never appear.
    expect(prompt).toContain('Never use the words "unlock", "leverage", or "delve"');
  });

  const STATE_KEYWORDS: Record<EmotionalState, string> = {
    excited: 'excited',
    busy: 'slammed',
    guarded: 'skeptical',
    status: 'neighbors',
  };

  (Object.keys(STATE_KEYWORDS) as EmotionalState[]).forEach(state => {
    it(`embodies the "${state}" persona distinctly from the other three`, () => {
      const prompt = buildCustomerSystemPrompt({ playbook: null, emotionalState: state, offer: NO_OFFER });
      expect(prompt.toLowerCase()).toContain(STATE_KEYWORDS[state]);

      const otherStates = (Object.keys(STATE_KEYWORDS) as EmotionalState[]).filter(s => s !== state);
      for (const other of otherStates) {
        expect(prompt.toLowerCase()).not.toContain(STATE_KEYWORDS[other]);
      }
    });
  });

  it('instructs the model to naturally raise the given objection when one is set', () => {
    const prompt = buildCustomerSystemPrompt({
      playbook: null,
      emotionalState: 'guarded',
      objective: 'the price feels too high for a few weeks of lights',
      offer: NO_OFFER,
    });

    expect(prompt).toContain('raise this exact objection');
    expect(prompt).toContain('the price feels too high for a few weeks of lights');
  });

  it('does not force a specific objection when none is given', () => {
    const prompt = buildCustomerSystemPrompt({ playbook: null, emotionalState: 'guarded', offer: NO_OFFER });

    expect(prompt).not.toContain('raise this exact objection');
    expect(prompt).toContain('Play the state naturally');
  });

  it('folds in the playbook ICP and objection vocabulary when a playbook is active', () => {
    const prompt = buildCustomerSystemPrompt({
      playbook: {
        icp: 'Homeowners on Long Island with a visible roofline.',
        angles: [],
        openers: [],
        objections: [{ objection: 'too expensive', response: '...' }],
        avoid: [],
        voicemail: '',
      },
      emotionalState: 'busy',
      offer: NO_OFFER,
    });

    expect(prompt).toContain('Homeowners on Long Island with a visible roofline.');
    expect(prompt).toContain('too expensive');
  });

  it('lists active offer elements so the customer can react to them realistically', () => {
    const prompt = buildCustomerSystemPrompt({
      playbook: null,
      emotionalState: 'excited',
      offer: [
        {
          key: 'fast_fix_48h',
          name: '48-hour fast-fix guarantee',
          customer_line: 'we fix it within 48 hours or your month is free.',
          grade_hint: 'said the 48-hour number',
          applies_to: 'holiday calls',
          situational: false,
        },
      ],
    });

    expect(prompt).toContain('48-hour fast-fix guarantee');
    expect(prompt).toContain('we fix it within 48 hours or your month is free.');
  });

  it('never emits an em dash', () => {
    const prompt = buildCustomerSystemPrompt({
      playbook: null,
      emotionalState: 'status',
      objective: 'wants a better price',
      offer: NO_OFFER,
    });
    expect(prompt).not.toContain('—');
  });
});
