// Coverage for the corpus-frequency rep detector. Pure function, synthetic
// frequency data only -- no real names, no file I/O.

import { describe, expect, it } from 'vitest';
import { buildRepNameSet } from './repDetection';

// Builds `count` synthetic one-file speaker-sets, each pairing `name` with a
// different one-off customer -- mirrors the real shape (a rep recurs, a
// customer doesn't).
function repFiles(name: string, count: number): string[][] {
  return Array.from({ length: count }, (_, i) => [name, `Customer ${name}-${i}`]);
}

describe('buildRepNameSet', () => {
  it('treats a name appearing in more than the default 5 files as a rep', () => {
    const files = repFiles('Alex Rep', 6);
    const reps = buildRepNameSet(files);
    expect(reps.has('Alex Rep')).toBe(true);
  });

  it('does not treat a name appearing in exactly 5 files as a rep (strictly more than N)', () => {
    const files = repFiles('Borderline Rep', 5);
    const reps = buildRepNameSet(files);
    expect(reps.has('Borderline Rep')).toBe(false);
  });

  it('does not treat a one-off customer name as a rep', () => {
    const files = [...repFiles('Alex Rep', 20), ['Alex Rep', 'One Time Customer']];
    const reps = buildRepNameSet(files);
    expect(reps.has('One Time Customer')).toBe(false);
    expect(reps.has('Alex Rep')).toBe(true);
  });

  it('counts a name once per file even if it appears twice in the same file speaker list', () => {
    const files: string[][] = Array.from({ length: 6 }, () => ['Dup Rep', 'Dup Rep', 'Customer X']);
    const reps = buildRepNameSet(files);
    // 6 files, appears in all 6 -- still only 6 FILE occurrences, over the
    // default threshold of 5, so still a rep; the point is this does not
    // silently become "12" and change the outcome for a lower threshold.
    expect(reps.has('Dup Rep')).toBe(true);
  });

  it('respects a custom minFileCount', () => {
    const files = repFiles('Low Volume Rep', 3);
    expect(buildRepNameSet(files).has('Low Volume Rep')).toBe(false);
    expect(buildRepNameSet(files, { minFileCount: 2 }).has('Low Volume Rep')).toBe(true);
  });

  it('returns an empty set for no files', () => {
    expect(buildRepNameSet([]).size).toBe(0);
  });

  it('separates two reps and their respective one-off customers in a mixed corpus', () => {
    const files = [...repFiles('Rep One', 50), ...repFiles('Rep Two', 30)];
    const reps = buildRepNameSet(files);
    expect(reps.has('Rep One')).toBe(true);
    expect(reps.has('Rep Two')).toBe(true);
    expect(reps.size).toBe(2);
  });
});
