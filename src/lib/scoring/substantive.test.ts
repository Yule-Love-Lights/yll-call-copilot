import { describe, expect, it } from 'vitest';
import { isSubstantiveTranscript } from './substantive';
import type { Utterance } from './metrics';

const REAL_CALL_TEXT =
  'Rep: Hi, this is Jake with Yule Love Lights, thanks for calling in today, how can I help?\n\n' +
  "Customer: Hi, I saw your lights on my neighbor's house and wanted a quote for my own place.\n\n" +
  'Rep: That is great, happy to help. Can I get your name and the address for the install?\n\n' +
  'Customer: Sure, it is 123 Main Street, my name is Pat.\n\n' +
  'Rep: Perfect Pat, let me ask a couple questions about what you have in mind for the display.\n\n'.repeat(10);

describe('isSubstantiveTranscript', () => {
  it('accepts a real two-speaker conversation with enough content', () => {
    expect(isSubstantiveTranscript({ raw_text: REAL_CALL_TEXT, utterances: null })).toBe(true);
  });

  it('rejects a transcript under the ~400 char floor even with no other signal', () => {
    expect(isSubstantiveTranscript({ raw_text: 'Hi there, thanks for calling, bye now.', utterances: null })).toBe(false);
  });

  it('rejects a voicemail-shaped single-speaker utterance array', () => {
    const utterances: Utterance[] = [
      { speaker: 'A', start: 0, end: 20, text: 'You have reached the voice messaging system, please leave a message after the tone.' },
    ];
    expect(isSubstantiveTranscript({ raw_text: REAL_CALL_TEXT, utterances })).toBe(false);
  });

  it('rejects when every turn from one speaker is IVR-shaped even with a real second speaker', () => {
    const utterances: Utterance[] = [
      { speaker: 'IVR', start: 0, end: 5, text: 'Please leave a message after the tone.' },
      { speaker: 'Rep', start: 6, end: 30, text: 'Hey it is Jake, just following up on your quote request, give me a call back when you get a chance, thanks so much.' },
    ];
    expect(isSubstantiveTranscript({ raw_text: REAL_CALL_TEXT, utterances })).toBe(false);
  });

  it('accepts a real exchange even when utterances is null but raw_text passes the junk-adjacent length/shape floor', () => {
    expect(isSubstantiveTranscript({ raw_text: REAL_CALL_TEXT, utterances: undefined })).toBe(true);
  });

  // Fix 7: speaker is number | string (the diarizer writes numeric ids at
  // runtime) -- the junk check must still work with numeric speakers.
  it('accepts a real two-speaker conversation using numeric diarizer speaker ids', () => {
    const utterances: Utterance[] = [
      { speaker: 0, start: 0, end: 5, text: 'Hey it is Jake, just following up on your quote request.' },
      { speaker: 1, start: 6, end: 30, text: 'Thanks for calling back, I did want to ask about the permanent lighting option.' },
    ];
    expect(isSubstantiveTranscript({ raw_text: REAL_CALL_TEXT, utterances })).toBe(true);
  });
});
