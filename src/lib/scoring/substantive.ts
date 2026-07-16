// The gate before scoreCall ever runs: only substantive calls get scored, so
// a voicemail, an IVR-only recording, or a near-empty transcript never earns
// a call_scores row. Reuses the exact junk heuristic (phrase list +
// per-speaker logic) the RingCentral ingest path already applies at extract
// time -- lifted into transcripts/junk.ts so both paths share one
// implementation -- plus its own raw_text length floor, since a call scored
// from raw_text alone (no utterances yet) has no speaker-turn signal to
// check at all.

import { junkReasonFromTurns } from '../transcripts/junk';
import type { Utterance } from './metrics';

// Below this, there's nothing real to score regardless of speaker shape --
// same rationale as junk.ts's own MIN_WORD_COUNT, just measured in raw_text
// characters since that's all we have before utterances are diarized.
const MIN_RAW_TEXT_CHARS = 400;

export type SubstantiveCheckInput = {
  raw_text: string;
  utterances?: Utterance[] | null;
};

export function isSubstantiveTranscript(input: SubstantiveCheckInput): boolean {
  if (input.raw_text.trim().length < MIN_RAW_TEXT_CHARS) return false;

  if (input.utterances && input.utterances.length > 0) {
    // junkReasonFromTurns's JunkTurn contract is speaker: string (shared with
    // the RingCentral text-parsed turns, which are always string labels);
    // stringify a diarizer's numeric speaker id to satisfy it. Distinctness
    // is preserved (different ids stringify differently), which is all the
    // single_speaker/automated_speaker checks need.
    const turns = input.utterances.map(u => ({ speaker: String(u.speaker), text: u.text }));
    if (junkReasonFromTurns(turns) !== null) return false;
  }

  return true;
}
