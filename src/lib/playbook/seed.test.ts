import { describe, it, expect } from 'vitest';
import { DEFAULT_VERTICALS, shouldSeedDefaults } from './seed';

describe('shouldSeedDefaults (seed route idempotency gate)', () => {
  it('seeds when the verticals table is empty', () => {
    expect(shouldSeedDefaults(0)).toBe(true);
  });

  it('does not seed when verticals already exist (idempotent on a second call)', () => {
    expect(shouldSeedDefaults(1)).toBe(false);
    expect(shouldSeedDefaults(4)).toBe(false);
    expect(shouldSeedDefaults(100)).toBe(false);
  });
});

describe('DEFAULT_VERTICALS', () => {
  it('has exactly the 4 YLL defaults with unique slugs', () => {
    expect(DEFAULT_VERTICALS).toHaveLength(4);
    const slugs = DEFAULT_VERTICALS.map(v => v.slug);
    expect(new Set(slugs).size).toBe(4);
    expect(slugs.sort()).toEqual(['commercial', 'event', 'holiday', 'permanent']);
  });

  it('gives every default a non-empty name and description', () => {
    for (const vertical of DEFAULT_VERTICALS) {
      expect(vertical.name.length).toBeGreaterThan(0);
      expect(vertical.description.length).toBeGreaterThan(0);
    }
  });
});
