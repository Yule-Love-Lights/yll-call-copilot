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

export function flattenPracticeTranscript(turns: Pick<PracticeTurn, 'speaker' | 'text'>[]): string {
  return turns.map(turn => `${SPEAKER_LABEL[turn.speaker]}: ${turn.text}`).join('\n\n');
}
