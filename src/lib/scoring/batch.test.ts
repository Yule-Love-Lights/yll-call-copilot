import { describe, expect, it } from 'vitest';
import { selectScoreCandidates, type ScoreCandidate } from './batch';

const REAL_CALL_TEXT =
  'Rep: Hi, this is Jake with Yule Love Lights, thanks for calling in today, how can I help?\n\n'.repeat(10) +
  "Customer: Hi, I saw your lights on my neighbor's house and wanted a quote.\n\n";

function candidate(id: string, overrides: Partial<ScoreCandidate> = {}): ScoreCandidate {
  return { id, raw_text: REAL_CALL_TEXT, utterances: null, ...overrides };
}

describe('selectScoreCandidates', () => {
  it('excludes already-scored transcripts', () => {
    const candidates = [candidate('a'), candidate('b'), candidate('c')];
    const result = selectScoreCandidates(candidates, new Set(['b']), 10);
    expect(result.map(c => c.id)).toEqual(['a', 'c']);
  });

  it('excludes non-substantive transcripts (too short)', () => {
    const candidates = [candidate('a'), candidate('b', { raw_text: 'too short' })];
    const result = selectScoreCandidates(candidates, new Set(), 10);
    expect(result.map(c => c.id)).toEqual(['a']);
  });

  it('caps the result at the given limit, preserving order (newest-first is the caller\'s ordering)', () => {
    const candidates = [candidate('a'), candidate('b'), candidate('c')];
    const result = selectScoreCandidates(candidates, new Set(), 2);
    expect(result.map(c => c.id)).toEqual(['a', 'b']);
  });

  it('returns an empty array when nothing qualifies', () => {
    const result = selectScoreCandidates([candidate('a')], new Set(['a']), 10);
    expect(result).toEqual([]);
  });
});
