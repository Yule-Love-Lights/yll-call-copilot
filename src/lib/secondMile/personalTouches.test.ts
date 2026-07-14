// Coverage for the personal-touch validator (mirrors validateProposals in
// src/lib/transcripts/distill.ts): a strict JSON array of {detail, category,
// quote}, empty array is a fine answer, a missing quote is rejected.

import { describe, it, expect } from 'vitest';
import { validateTouches } from './personalTouches';

describe('validateTouches', () => {
  it('accepts an empty array -- no personal details found is a fine answer', () => {
    const result = validateTouches({ touches: [] });
    expect(result).toEqual({ valid: true, touches: [] });
  });

  it('accepts a well-formed array of touches', () => {
    const result = validateTouches({
      touches: [
        { detail: "their dog's name is Biscuit", category: 'pet', quote: 'our dog Biscuit loves the lights' },
      ],
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.touches).toHaveLength(1);
      expect(result.touches[0].detail).toContain('Biscuit');
    }
  });

  it('rejects a touch missing quote', () => {
    const result = validateTouches({
      touches: [{ detail: "their dog's name is Biscuit", category: 'pet' }],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects a touch missing detail', () => {
    const result = validateTouches({ touches: [{ category: 'pet', quote: 'our dog Biscuit' }] });
    expect(result.valid).toBe(false);
  });

  it('rejects a touch missing category', () => {
    const result = validateTouches({ touches: [{ detail: 'x', quote: 'y' }] });
    expect(result.valid).toBe(false);
  });

  it('rejects when touches is not an array', () => {
    expect(validateTouches({ touches: 'nope' }).valid).toBe(false);
  });

  it('rejects a non-object top-level value', () => {
    expect(validateTouches(null).valid).toBe(false);
    expect(validateTouches('nope').valid).toBe(false);
  });

  it('rejects an item that is not an object', () => {
    expect(validateTouches({ touches: ['just a string'] }).valid).toBe(false);
  });
});
