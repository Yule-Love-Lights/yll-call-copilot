// Coverage for the simulator scripts' shape: well-formed exchanges in
// increasing time order, and (since the whole point of the simulator is to
// drive the real engine) that playing each script through detectTriggers
// actually exercises every trigger type -- a regression guard against a
// future dialogue edit accidentally removing the phrase that fires one.

import { describe, it, expect } from 'vitest';
import { createLiveEngineState, detectTriggers, type TriggerType } from './engine';
import { DIFFICULT_CUSTOMER_CALL, getSimulatorScript, SIMULATOR_SCRIPTS, STANDARD_CALL } from './simulator';

describe('SIMULATOR_SCRIPTS shape', () => {
  it('has unique, non-empty ids and labels', () => {
    const ids = SIMULATOR_SCRIPTS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const script of SIMULATOR_SCRIPTS) {
      expect(script.id.trim()).not.toBe('');
      expect(script.label.trim()).not.toBe('');
    }
  });

  it('includes the standard call and a difficult-customer variant', () => {
    expect(SIMULATOR_SCRIPTS).toContain(STANDARD_CALL);
    expect(SIMULATOR_SCRIPTS).toContain(DIFFICULT_CUSTOMER_CALL);
  });

  for (const script of [STANDARD_CALL, DIFFICULT_CUSTOMER_CALL]) {
    describe(`"${script.id}"`, () => {
      it('has well-formed exchanges in strictly increasing time order', () => {
        expect(script.exchanges.length).toBeGreaterThan(0);
        let lastAtMs = -1;
        for (const exchange of script.exchanges) {
          expect(['rep', 'customer']).toContain(exchange.speaker);
          expect(exchange.text.trim()).not.toBe('');
          expect(exchange.atMs).toBeGreaterThan(lastAtMs);
          if (exchange.silenceMs !== undefined) expect(exchange.silenceMs).toBeGreaterThan(0);
          lastAtMs = exchange.atMs;
        }
      });

      it('alternates between both speakers rather than one side monologuing', () => {
        const speakers = new Set(script.exchanges.map(e => e.speaker));
        expect(speakers.has('rep')).toBe(true);
        expect(speakers.has('customer')).toBe(true);
      });
    });
  }

  it('the standard call runs roughly 30 exchanges (warm open through a booked close)', () => {
    expect(STANDARD_CALL.exchanges.length).toBeGreaterThanOrEqual(28);
    expect(STANDARD_CALL.exchanges.length).toBeLessThanOrEqual(34);
  });

  it('every script exercises every trigger type through the real engine', () => {
    for (const script of SIMULATOR_SCRIPTS) {
      const state = createLiveEngineState();
      const fired = new Set<TriggerType>();
      for (const exchange of script.exchanges) {
        const triggers = detectTriggers(
          { speaker: exchange.speaker, text: exchange.text, atMs: exchange.atMs, silenceMs: exchange.silenceMs },
          state,
        );
        triggers.forEach(t => fired.add(t.type));
      }
      const expected: TriggerType[] =
        script.id === 'difficult'
          ? ['price', 'objection', 'question', 'silence', 'competitor']
          : ['price', 'objection', 'question', 'silence', 'competitor', 'closing'];
      for (const type of expected) {
        expect(fired.has(type), `${script.id} never fired ${type}`).toBe(true);
      }
    }
  });
});

describe('getSimulatorScript', () => {
  it('finds a script by id', () => {
    expect(getSimulatorScript('standard')).toBe(STANDARD_CALL);
    expect(getSimulatorScript('difficult')).toBe(DIFFICULT_CUSTOMER_CALL);
  });

  it('returns undefined for an unknown id', () => {
    expect(getSimulatorScript('nope')).toBeUndefined();
  });
});
