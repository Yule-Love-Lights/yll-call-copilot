// Coverage for flattenUtterances -- the pure part of the Deepgram
// transcription wrapper. The network call itself (transcribeRecording) is
// not unit tested here: it needs a live Deepgram key to verify against a
// real payload shape, flagged as a live-check item in the PR.

import { describe, it, expect } from 'vitest';
import { flattenUtterances, isDeepgramConfigured } from './deepgram';

describe('isDeepgramConfigured', () => {
  it('is true only when DEEPGRAM_API_KEY is set', () => {
    delete process.env.DEEPGRAM_API_KEY;
    expect(isDeepgramConfigured()).toBe(false);
    process.env.DEEPGRAM_API_KEY = 'dg-test-key';
    expect(isDeepgramConfigured()).toBe(true);
    delete process.env.DEEPGRAM_API_KEY;
  });
});

describe('flattenUtterances', () => {
  it('flattens diarized utterances into "Speaker N: text" lines', () => {
    const raw = flattenUtterances([
      { speaker: 0, start: 0, end: 2, text: 'Thanks for calling Yule Love Lights.' },
      { speaker: 1, start: 2, end: 5, text: 'Hi, I wanted a quote for permanent lights.' },
      { speaker: 0, start: 5, end: 8, text: 'Happy to help with that.' },
    ]);

    expect(raw).toBe(
      [
        'Speaker 0: Thanks for calling Yule Love Lights.',
        'Speaker 1: Hi, I wanted a quote for permanent lights.',
        'Speaker 0: Happy to help with that.',
      ].join('\n\n'),
    );
  });

  it('trims whitespace and drops empty utterances', () => {
    const raw = flattenUtterances([
      { speaker: 0, start: 0, end: 1, text: '  hello there  ' },
      { speaker: 1, start: 1, end: 1, text: '   ' },
      { speaker: 1, start: 2, end: 3, text: '' },
    ]);

    expect(raw).toBe('Speaker 0: hello there');
  });

  it('returns an empty string for no utterances', () => {
    expect(flattenUtterances([])).toBe('');
  });

  it('preserves more than two distinct speaker indices', () => {
    const raw = flattenUtterances([
      { speaker: 0, start: 0, end: 1, text: 'one' },
      { speaker: 2, start: 1, end: 2, text: 'two' },
    ]);

    expect(raw).toBe('Speaker 0: one\n\nSpeaker 2: two');
  });
});
