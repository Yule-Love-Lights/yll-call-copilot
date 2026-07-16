import { describe, expect, it } from 'vitest';
import { computeHardMetrics, identifyRepSpeaker, type Utterance } from './metrics';

// Synthetic 2-speaker call. A speaks first (assumed rep, see
// identifyRepSpeaker's own comment for the reasoning/deviation).
//
//   A: 0-5    "Hi, this is Jake with Yule Love Lights, how are you today?"
//   B: 6-10   "I'm doing okay."                                  (gap 1s -- not dead air)
//   A: 14-20  "That's great to hear. What made you reach out to us today?"  (gap 4s -- dead air)
//   B: 19-25  "Well I saw your lights on my neighbor's house."   (starts 1s before A's utt ends -- interruption)
const CALL: Utterance[] = [
  { speaker: 'A', start: 0, end: 5, text: 'Hi, this is Jake with Yule Love Lights, how are you today?' },
  { speaker: 'B', start: 6, end: 10, text: "I'm doing okay." },
  { speaker: 'A', start: 14, end: 20, text: "That's great to hear. What made you reach out to us today?" },
  { speaker: 'B', start: 19, end: 25, text: "Well I saw your lights on my neighbor's house." },
];

describe('identifyRepSpeaker', () => {
  it('picks the first speaker to talk', () => {
    expect(identifyRepSpeaker(CALL)).toBe('A');
  });

  it('returns null for an empty call', () => {
    expect(identifyRepSpeaker([])).toBeNull();
  });

  // Fix 7: speaker is honestly typed number | string because the diarizer
  // writes numeric speaker ids at runtime.
  it('accepts a numeric speaker id', () => {
    const utterances: Utterance[] = [{ speaker: 0, start: 0, end: 5, text: 'hi' }];
    expect(identifyRepSpeaker(utterances)).toBe(0);
  });
});

describe('computeHardMetrics', () => {
  it('returns all zeros for an empty utterance array', () => {
    expect(computeHardMetrics([])).toEqual({
      rep_talk_ratio: 0,
      question_count: 0,
      dead_air_seconds: 0,
      interruption_count: 0,
      duration_seconds: 0,
    });
  });

  it('computes talk ratio as rep speaking time over total speaking time', () => {
    // rep (A): (5-0) + (20-14) = 11; total: 11 + (10-6) + (25-19) = 11 + 10 = 21
    const { rep_talk_ratio } = computeHardMetrics(CALL);
    expect(rep_talk_ratio).toBeCloseTo(11 / 21, 5);
  });

  it('sums only gaps strictly greater than 3s as dead air', () => {
    // gap 1 (A->B): 1s, not counted. gap 2 (B->A): 4s, counted. gap 3 (A->B): -1s (overlap), not counted.
    expect(computeHardMetrics(CALL).dead_air_seconds).toBe(4);
  });

  it('does not count a gap of exactly 3s as dead air', () => {
    const utterances: Utterance[] = [
      { speaker: 'A', start: 0, end: 5, text: 'hello there' },
      { speaker: 'B', start: 8, end: 10, text: 'hi' },
    ];
    expect(computeHardMetrics(utterances).dead_air_seconds).toBe(0);
  });

  it('counts an utterance starting more than 0.5s before the previous one ends as an interruption', () => {
    // B starts at 19, A's previous utterance ends at 20 -- 19 < 20 - 0.5.
    expect(computeHardMetrics(CALL).interruption_count).toBe(1);
  });

  it('does not count an overlap of exactly 0.5s as an interruption', () => {
    const utterances: Utterance[] = [
      { speaker: 'A', start: 0, end: 10, text: 'hello there friend' },
      { speaker: 'B', start: 9.5, end: 12, text: 'hi' },
    ];
    expect(computeHardMetrics(utterances).interruption_count).toBe(0);
  });

  it('counts rep-speaker sentences ending in a question mark', () => {
    // A's two utterances contain two "?"-terminated sentences total.
    expect(computeHardMetrics(CALL).question_count).toBe(2);
  });

  it('does not count a customer question toward question_count', () => {
    const utterances: Utterance[] = [
      { speaker: 'A', start: 0, end: 5, text: 'Hello, thanks for calling.' },
      { speaker: 'B', start: 6, end: 10, text: 'Do you install permanent lights?' },
    ];
    expect(computeHardMetrics(utterances).question_count).toBe(0);
  });

  it('computes duration as the span from the first start to the last end', () => {
    expect(computeHardMetrics(CALL).duration_seconds).toBe(25);
  });

  // Fix 5: identifyRepSpeaker used to key off the UNSORTED array's first
  // element while every timing computation above uses the start-sorted
  // order -- a non-chronologically-stored utterances array silently swapped
  // rep and customer.
  it('identifies the rep from the chronologically-first utterance, not the first element in storage order', () => {
    // Stored out of order: B's utterance (start 6) is listed before A's
    // (start 0), even though A actually spoke first chronologically.
    const storedOutOfOrder: Utterance[] = [
      { speaker: 'B', start: 6, end: 10, text: "I'm doing okay." },
      { speaker: 'A', start: 0, end: 5, text: 'Hi, this is Jake with Yule Love Lights, how are you today?' },
    ];
    // A's duration is 5, B's is 4, total 9. If the rep were wrongly
    // resolved as 'B' (storage-order first), rep_talk_ratio would be 4/9.
    expect(computeHardMetrics(storedOutOfOrder).rep_talk_ratio).toBeCloseTo(5 / 9, 5);
  });

  // Fix 7: numeric speaker ids (what the diarizer actually writes) must work
  // end to end, not just string labels.
  it('computes correctly with numeric speaker ids', () => {
    const utterances: Utterance[] = [
      { speaker: 0, start: 0, end: 5, text: 'Hi, this is Jake, how can I help?' },
      { speaker: 1, start: 6, end: 10, text: 'Just calling about a quote.' },
    ];
    expect(identifyRepSpeaker(utterances)).toBe(0);
    expect(computeHardMetrics(utterances).rep_talk_ratio).toBeCloseTo(5 / 9, 5);
  });
});
