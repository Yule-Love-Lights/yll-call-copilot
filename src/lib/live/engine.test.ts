// Coverage for detectTriggers: one case per trigger type, the customer-only
// design choice, and the 45s per-type rate limit.

import { describe, it, expect } from 'vitest';
import { createLiveEngineState, detectTriggers, RATE_LIMIT_MS, SILENCE_THRESHOLD_MS } from './engine';

describe('detectTriggers', () => {
  it('fires PRICE on price/cost/expensive/how much', () => {
    const state = createLiveEngineState();
    expect(detectTriggers({ speaker: 'customer', text: 'How much does this cost?', atMs: 1000 }, state).map(t => t.type)).toEqual(
      expect.arrayContaining(['price']),
    );
  });

  it('fires OBJECTION on not interested/think about it/spouse/busy/already have', () => {
    const cases = [
      'we are not interested right now',
      'let me think about it',
      'I need to talk to my spouse',
      'we have just been really busy',
      'we already have someone doing that',
    ];
    for (const text of cases) {
      const state = createLiveEngineState();
      const triggers = detectTriggers({ speaker: 'customer', text, atMs: 1000 }, state);
      expect(triggers.map(t => t.type)).toContain('objection');
    }
  });

  it('fires QUESTION only when the customer text ends with a question mark', () => {
    const state = createLiveEngineState();
    const withQuestion = detectTriggers({ speaker: 'customer', text: 'Do you serve my area?', atMs: 1000 }, state);
    expect(withQuestion.map(t => t.type)).toContain('question');

    const withoutQuestion = detectTriggers({ speaker: 'customer', text: 'That sounds fine.', atMs: 2000 }, state);
    expect(withoutQuestion.map(t => t.type)).not.toContain('question');
  });

  it('fires COMPETITOR on "other company" / "cheaper quote"', () => {
    const state1 = createLiveEngineState();
    expect(
      detectTriggers({ speaker: 'customer', text: 'We got a quote from another company already.', atMs: 1000 }, state1).map(
        t => t.type,
      ),
    ).toContain('competitor');

    const state2 = createLiveEngineState();
    expect(
      detectTriggers({ speaker: 'customer', text: 'Their cheaper quote did not include takedown.', atMs: 1000 }, state2).map(
        t => t.type,
      ),
    ).toContain('competitor');
  });

  it('fires CLOSING on "when can you" / schedule / book', () => {
    const cases = ['When can you get out here?', 'Can we schedule this for Saturday?', 'Can we book it now?'];
    for (const text of cases) {
      const state = createLiveEngineState();
      expect(detectTriggers({ speaker: 'customer', text, atMs: 1000 }, state).map(t => t.type)).toContain('closing');
    }
  });

  it('fires SILENCE once the caller-side gap passes the threshold, regardless of text', () => {
    const state = createLiveEngineState();
    const below = detectTriggers({ speaker: 'customer', text: '', atMs: 1000, silenceMs: SILENCE_THRESHOLD_MS - 1 }, state);
    expect(below.map(t => t.type)).not.toContain('silence');

    const atThreshold = detectTriggers({ speaker: 'customer', text: '', atMs: 2000, silenceMs: SILENCE_THRESHOLD_MS }, state);
    expect(atThreshold.map(t => t.type)).toContain('silence');
  });

  it('never fires a keyword trigger off what the rep said', () => {
    const state = createLiveEngineState();
    const triggers = detectTriggers(
      { speaker: 'rep', text: 'So the price would be around eight hundred dollars, when can you decide?', atMs: 1000 },
      state,
    );
    expect(triggers).toEqual([]);
  });

  it('can fire more than one trigger type from a single segment', () => {
    const state = createLiveEngineState();
    const triggers = detectTriggers({ speaker: 'customer', text: 'How much does it cost?', atMs: 1000 }, state);
    const types = triggers.map(t => t.type);
    expect(types).toEqual(expect.arrayContaining(['price', 'question']));
  });

  describe('45s rate limit per trigger type', () => {
    it('suppresses a repeat of the same trigger type inside the window', () => {
      const state = createLiveEngineState();
      const first = detectTriggers({ speaker: 'customer', text: 'How much does it cost?', atMs: 0 }, state);
      expect(first.map(t => t.type)).toContain('price');

      const second = detectTriggers(
        { speaker: 'customer', text: 'Seriously, what does it cost?', atMs: RATE_LIMIT_MS - 1 },
        state,
      );
      expect(second.map(t => t.type)).not.toContain('price');
    });

    it('allows the same trigger type again once the window has fully elapsed', () => {
      const state = createLiveEngineState();
      detectTriggers({ speaker: 'customer', text: 'How much does it cost?', atMs: 0 }, state);

      const third = detectTriggers({ speaker: 'customer', text: 'What does it cost?', atMs: RATE_LIMIT_MS }, state);
      expect(third.map(t => t.type)).toContain('price');
    });

    it('rate-limits each trigger type independently', () => {
      const state = createLiveEngineState();
      detectTriggers({ speaker: 'customer', text: 'How much does it cost?', atMs: 0 }, state);

      // A different type (objection) fires even though price is still
      // inside its own 45s window.
      const triggers = detectTriggers({ speaker: 'customer', text: 'We are not interested.', atMs: 1000 }, state);
      expect(triggers.map(t => t.type)).toContain('objection');
    });
  });
});
