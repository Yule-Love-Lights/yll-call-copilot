// Pure trigger-detection core for live call coaching -- no I/O, fully
// unit-testable (per the Phase 4 brief). A live call is a stream of short
// segments (POST /api/live/segment, one per finalized utterance); this file
// decides which segments deserve a coaching card and builds the prompt for
// one, but never calls Claude itself (see ./card.ts for the I/O boundary,
// same split as playbook/generate.ts vs playbook/normalize.ts+validate.ts).
//
// Design choice: every keyword trigger reacts to what the CUSTOMER just
// said, never the rep -- the rep already knows what they themselves said,
// and the README's very first line is "The AI coaches the rep and never
// speaks to the customer." SILENCE is the one exception: it is a dead-air
// gap flag on the segment, not customer speech, so it does not depend on
// `speaker`.

import type { Playbook } from '../playbook/types';

export type TriggerType = 'price' | 'objection' | 'question' | 'silence' | 'competitor' | 'closing';

export type Segment = {
  speaker: 'rep' | 'customer';
  text: string;
  // Elapsed milliseconds since the call/session started. The caller (POST
  // /api/live/segment) already needs this for the coaching_events.at_ms
  // column, so it is threaded in here too rather than read from a clock in
  // this file -- keeps detectTriggers deterministic and testable.
  atMs: number;
  // Length of a caller-side dead-air gap immediately before this segment, if
  // one was measured. `text` can be empty when this is the only signal.
  silenceMs?: number;
};

export type Trigger = {
  type: TriggerType;
  atMs: number;
  // The phrase (or, for silence, a short description) that fired the
  // trigger -- carried into the coach prompt and useful for debugging.
  matchedText: string;
};

// Per-call state threaded through repeated detectTriggers calls so the same
// trigger type doesn't fire a new card every couple of seconds. The route
// rebuilds this from the coaching_events already stored for the call on
// every request (serverless -- no in-memory state survives between polls);
// detectTriggers just reads and updates it.
export type LiveEngineState = {
  lastFiredAtMs: Partial<Record<TriggerType, number>>;
};

export function createLiveEngineState(): LiveEngineState {
  return { lastFiredAtMs: {} };
}

export const RATE_LIMIT_MS = 45_000;
export const SILENCE_THRESHOLD_MS = 4_000;

const PRICE_PATTERN = /price|cost|expensive|how much/i;
const OBJECTION_PATTERN = /not interested|think about it|spouse|busy|already have/i;
const COMPETITOR_PATTERN = /other company|cheaper quote/i;
const CLOSING_PATTERN = /when can you|schedule|book/i;

function firstMatch(pattern: RegExp, text: string): string | null {
  const m = text.match(pattern);
  return m ? m[0] : null;
}

function canFire(type: TriggerType, atMs: number, state: LiveEngineState): boolean {
  const last = state.lastFiredAtMs[type];
  return last === undefined || atMs - last >= RATE_LIMIT_MS;
}

function fire(type: TriggerType, atMs: number, matchedText: string, state: LiveEngineState, out: Trigger[]): void {
  if (!canFire(type, atMs, state)) return;
  state.lastFiredAtMs[type] = atMs;
  out.push({ type, atMs, matchedText });
}

export function detectTriggers(segment: Segment, state: LiveEngineState): Trigger[] {
  const triggers: Trigger[] = [];

  // Dead air is measured on the line, not attributed to either speaker, but
  // it is always the rep who needs the nudge to fill it.
  if (segment.silenceMs !== undefined && segment.silenceMs >= SILENCE_THRESHOLD_MS) {
    fire('silence', segment.atMs, `${segment.silenceMs}ms of silence`, state, triggers);
  }

  if (segment.speaker === 'customer' && segment.text.trim()) {
    const text = segment.text;

    const price = firstMatch(PRICE_PATTERN, text);
    if (price) fire('price', segment.atMs, price, state, triggers);

    const objection = firstMatch(OBJECTION_PATTERN, text);
    if (objection) fire('objection', segment.atMs, objection, state, triggers);

    const competitor = firstMatch(COMPETITOR_PATTERN, text);
    if (competitor) fire('competitor', segment.atMs, competitor, state, triggers);

    const closing = firstMatch(CLOSING_PATTERN, text);
    if (closing) fire('closing', segment.atMs, closing, state, triggers);

    if (text.trim().endsWith('?')) fire('question', segment.atMs, text.trim(), state, triggers);
  }

  return triggers;
}

// Compact prompt for one coaching card (see ./card.ts for the Claude call
// that consumes it). Kept short on purpose: this happens mid-conversation,
// so latency and token cost both matter far more than for the once-per-
// vertical playbook generation call.
const ROLLING_TRANSCRIPT_CHAR_CAP = 2000;

export function buildCoachPrompt(trigger: Trigger, rollingTranscript: string, playbook: Playbook | null): string {
  const recentTranscript =
    rollingTranscript.length > ROLLING_TRANSCRIPT_CHAR_CAP
      ? rollingTranscript.slice(-ROLLING_TRANSCRIPT_CHAR_CAP)
      : rollingTranscript;

  return [
    `Trigger: ${trigger.type} (matched "${trigger.matchedText}")`,
    '',
    'Recent call transcript (oldest to newest):',
    recentTranscript.trim() || '(no transcript yet)',
    '',
    'Playbook context:',
    playbook ? JSON.stringify(playbook, null, 2) : '(no active playbook for this vertical)',
    '',
    'Give the rep one coaching card for this moment.',
  ].join('\n');
}
