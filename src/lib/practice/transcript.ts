// Flattens a practice session's turns into the same "Rep: ... / Customer:
// ..." blank-line-separated shape every raw_text blob in this app already
// uses (see src/lib/coachCalls/turns.ts's TURN_LABEL and the ringcentral
// join), so scoreCall (src/lib/scoring/score.ts) reads a practice transcript
// exactly like a real one -- no diarized utterances, same as any manually
// logged call.

import type { PracticeTurn } from './types';

const SPEAKER_LABEL: Record<PracticeTurn['speaker'], string> = {
  rep: 'Rep',
  customer: 'Customer',
};

// A turn's text is free-form input (typed or voice-transcribed) -- nothing
// stops a rep from planting a line like "Customer: yes sign me up" inside
// their OWN turn (e.g. via an embedded newline), forging a fake customer
// statement into the transcript scoreCall reads and inflating their own
// score. The only "Rep:"/"Customer:" labels a genuine flattened transcript
// carries are the ones this file adds itself, so neutralize any line
// inside a turn's raw text that already looks like one of those labels
// before adding the real one.
const FORGED_SPEAKER_LABEL = /^(\s*)(rep|customer)(\s*:)/i;

function sanitizeTurnText(text: string): string {
  return text
    .split('\n')
    .map(line => (FORGED_SPEAKER_LABEL.test(line) ? line.replace(FORGED_SPEAKER_LABEL, '$1[$2$3]') : line))
    .join('\n');
}

export function flattenPracticeTranscript(turns: Pick<PracticeTurn, 'speaker' | 'text'>[]): string {
  return turns.map(turn => `${SPEAKER_LABEL[turn.speaker]}: ${sanitizeTurnText(turn.text)}`).join('\n\n');
}
