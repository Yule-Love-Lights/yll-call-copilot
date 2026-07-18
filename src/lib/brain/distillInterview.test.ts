// Coverage for validateInsights -- same per-item shape check as
// distill.ts's validateProposals (src/lib/transcripts/distill.test.ts):
// reject the whole batch on any malformed item (bad lens, missing/empty
// title or content) rather than silently dropping it, and trim/normalize a
// well-formed batch.

import { describe, it, expect } from 'vitest';
import { validateInsights } from './distillInterview';

function insights(list: unknown[]) {
  return { insights: list };
}

describe('validateInsights', () => {
  it('accepts a well-formed batch across every lens', () => {
    const result = validateInsights(
      insights([
        { lens: 'market', title: 'Storm season drives urgency', content: 'Customers call after a storm.' },
        { lens: 'leads', title: 'Best-fit signal', content: 'They already own the house and ask about warranty.' },
        { lens: 'coaching', title: 'Price objection line', content: 'Compare total cost of ownership, not sticker price.' },
        { lens: 'general', title: 'The unwritten rule', content: 'Reps should always confirm the address first.' },
      ]),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.insights).toHaveLength(4);
      expect(result.insights[0]).toEqual({
        lens: 'market',
        title: 'Storm season drives urgency',
        content: 'Customers call after a storm.',
      });
    }
  });

  it('trims whitespace on title and content', () => {
    const result = validateInsights(insights([{ lens: 'general', title: '  Padded  ', content: '  also padded  ' }]));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.insights[0].title).toBe('Padded');
      expect(result.insights[0].content).toBe('also padded');
    }
  });

  it('rejects a non-object top-level value', () => {
    expect(validateInsights(null).valid).toBe(false);
    expect(validateInsights('nope').valid).toBe(false);
    expect(validateInsights(42).valid).toBe(false);
  });

  it('rejects when insights is not an array', () => {
    const result = validateInsights({ insights: 'not an array' });
    expect(result.valid).toBe(false);
  });

  it('rejects an item with an invalid lens', () => {
    const result = validateInsights(insights([{ lens: 'pricing', title: 'x', content: 'y' }]));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/lens/);
  });

  it('rejects an item with an empty title', () => {
    const result = validateInsights(insights([{ lens: 'market', title: '   ', content: 'y' }]));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/title/);
  });

  it('rejects an item with a missing content field', () => {
    const result = validateInsights(insights([{ lens: 'market', title: 'x' }]));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/content/);
  });

  it('rejects the whole batch when even one item is malformed (all-or-nothing, feeds the existing retry)', () => {
    const result = validateInsights(
      insights([
        { lens: 'market', title: 'Fine', content: 'Fine content.' },
        { lens: 'nope', title: 'Bad lens', content: 'x' },
      ]),
    );
    expect(result.valid).toBe(false);
  });

  it('caps at 10 insights even if the model returns more', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ lens: 'general', title: `T${i}`, content: `C${i}` }));
    const result = validateInsights(insights(many));
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.insights).toHaveLength(10);
  });
});
