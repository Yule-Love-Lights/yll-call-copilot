import { describe, expect, it } from 'vitest';
import { flattenPracticeTranscript } from './transcript';

describe('flattenPracticeTranscript', () => {
  it('labels rep and customer turns and separates them with a blank line, matching real call raw_text', () => {
    const text = flattenPracticeTranscript([
      { speaker: 'customer', text: 'Hello?' },
      { speaker: 'rep', text: 'Hi, this is Jake with Yule Love Lights.' },
      { speaker: 'customer', text: 'Oh hi.' },
    ]);

    expect(text).toBe('Customer: Hello?\n\nRep: Hi, this is Jake with Yule Love Lights.\n\nCustomer: Oh hi.');
  });

  it('returns an empty string for no turns', () => {
    expect(flattenPracticeTranscript([])).toBe('');
  });

  it('splits back into the same speaker/text pairs via the app-wide turn splitter', async () => {
    const { splitRawTextIntoTurns } = await import('../coachCalls/turns');
    const turns = [
      { speaker: 'customer' as const, text: 'Hello?' },
      { speaker: 'rep' as const, text: 'Hi there.' },
    ];
    const flattened = flattenPracticeTranscript(turns);
    const parsed = splitRawTextIntoTurns(flattened);

    expect(parsed).toEqual([
      { speaker: 'Customer', text: 'Hello?' },
      { speaker: 'Rep', text: 'Hi there.' },
    ]);
  });
});
