// Parses RingCentral call-transcript .txt exports -- a different shape from
// the header-block/CSV format parse.ts handles. One file = one call; the
// call's date/time lives ONLY in the filename (there is no in-body header),
// and the body is a sequence of "Speaker Name | DD Mon YYYY H:MM AM/PM" turn
// headers, each followed by one or more lines of that speaker's spoken
// text. There is no reliable label for which of the (usually two) speakers
// is the YLL rep vs the customer within a single file -- see
// repDetection.ts for how the corpus-wide rep name set is built from many
// files, which pickCustomerName below then uses to pick out the non-rep
// speaker.

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Anchors the whole filename (not just a substring) so a name that merely
// contains date-shaped digits somewhere can't false-match. Tolerates the
// " (1)" / " (2)" duplicate-download suffix seen in the real export (e.g.
// "12_Apr_2026_11_25_AM_transcript (1).txt") and case on the month/AM-PM
// letters, though every real file observed uses "Dec"/"AM" capitalization.
const FILENAME_DATE = /^(\d{1,2})_([A-Za-z]{3})_(\d{4})_(\d{1,2})_(\d{2})_(AM|PM)_transcript(?:\s*\(\d+\))?\.txt$/i;

// The company places and receives every call from its home timezone --
// America/New_York -- and the filename only ever carries a wall-clock time,
// never a UTC offset. Assuming ET for every row is the same assumption this
// app already makes everywhere else; there is no per-call timezone data to
// do better.
const COMPANY_TIME_ZONE = 'America/New_York';

// Returns, in ms, how far `timeZone`'s wall clock is from UTC at `instantMs`
// (negative for zones behind UTC, e.g. -18000000 for EST).
function timeZoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asIfUtc - instantMs;
}

// Converts wall-clock components IN `timeZone` to the matching UTC instant.
// Standard two-step approximation (the same one date-fns-tz's
// zonedTimeToUtc uses): guess the offset by formatting the naive-UTC
// instant in the target zone, then subtract it back out. Accurate to the
// minute except inside the roughly one-hour DST-transition window twice a
// year -- not a concern here since no call is placed at 2am.
function zonedTimeToUtcIso(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): string {
  const naiveUtc = Date.UTC(year, monthIndex, day, hour, minute, 0);
  const offset = timeZoneOffsetMs(naiveUtc, timeZone);
  return new Date(naiveUtc - offset).toISOString();
}

export function parseRingCentralFilenameDate(filename: string): string | null {
  const match = filename.match(FILENAME_DATE);
  if (!match) return null;
  const [, dayStr, monStr, yearStr, hourStr, minuteStr, ampm] = match;

  const month = MONTHS[monStr.toLowerCase()];
  if (month === undefined) return null;

  const day = Number(dayStr);
  const year = Number(yearStr);
  const minute = Number(minuteStr);
  if (day < 1 || day > 31 || minute > 59) return null;

  let hour = Number(hourStr) % 12;
  if (ampm.toUpperCase() === 'PM') hour += 12;

  return zonedTimeToUtcIso(year, month, day, hour, minute, COMPANY_TIME_ZONE);
}

// ─── Turn parsing ───────────────────────────────────────────────────────────

export type RingCentralTurn = { speaker: string; text: string };

export type ParsedRingCentralTranscript = {
  called_at: string | null;
  speakers: string[];
  turns: RingCentralTurn[];
  raw_text: string;
  wordCount: number;
};

// One turn header per line: "Speaker Name | DD Mon YYYY H:MM AM/PM", nothing
// else on the line. Every other line is spoken text belonging to whichever
// header preceded it.
const TURN_HEADER = /^(.+?) \| (\d{1,2} [A-Za-z]{3} \d{4} \d{1,2}:\d{2} (?:AM|PM))\s*$/;

// True if at least one line looks like a RingCentral turn header, regardless
// of filename -- used by the browser upload route (src/app/api/ingest/
// transcripts/route.ts) to auto-detect this format for an ad-hoc upload.
export function looksLikeRingCentralTranscript(text: string): boolean {
  return text.split(/\r?\n/).some(line => TURN_HEADER.test(line));
}

function wordsIn(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function parseRingCentralTranscript(filename: string, text: string): ParsedRingCentralTranscript {
  const lines = text.split(/\r?\n/);
  const turns: RingCentralTurn[] = [];
  let current: RingCentralTurn | null = null;

  for (const line of lines) {
    const headerMatch = line.match(TURN_HEADER);
    if (headerMatch) {
      if (current) turns.push(current);
      current = { speaker: headerMatch[1].trim(), text: '' };
      continue;
    }
    if (!current) continue; // stray text before the first header -- ignore
    const spoken = line.trim(); // tolerate leading spaces on spoken lines
    if (!spoken) continue; // blank line between turns, or a blank turn
    current.text = current.text ? `${current.text} ${spoken}` : spoken;
  }
  if (current) turns.push(current);

  // Dedup while preserving first-appearance order (readable in raw_text /
  // useful for callers that print speakers in a stable order).
  const speakers = [...new Set(turns.map(t => t.speaker))];

  // Reconstructed, not the original file body verbatim: drops the
  // per-turn date stamp (redundant once called_at is stored separately) but
  // keeps the speaker label on every line, so Claude's extraction prompt
  // (extract.ts) still sees who said what.
  const raw_text = turns.map(t => `${t.speaker}: ${t.text}`).join('\n\n');
  const wordCount = turns.reduce((sum, t) => sum + wordsIn(t.text), 0);

  return {
    called_at: parseRingCentralFilenameDate(filename),
    speakers,
    turns,
    raw_text,
    wordCount,
  };
}

// ─── Junk (voicemail / IVR) detection ──────────────────────────────────────
// A "phrase" here is deliberately a short, punctuation-tolerant fragment
// (e.g. "stay on the line" rather than "please stay on the line") because
// RingCentral's transcription inserts erratic commas/periods mid-sentence
// ("Thanks, please. Stay on the line."), which would break a longer literal
// match. Compiled from what actually recurs across the tiny/short files in
// the real 1,639-file export (grepped, not guessed) -- best-effort, not
// exhaustive: a heavily garbled voicemail greeting can still slip through as
// "kept", which just means it gets a near-empty extraction rather than
// being excluded outright (graceful degradation, not data corruption).
const IVR_PHRASES = [
  'is not available',
  'not available right now',
  'not available at the tone',
  'forwarded to voicemail',
  'forwarded to an automatic voice',
  'forwarded to an automated voice',
  'voice messaging system',
  'record your message',
  'record your name and reason for calling',
  'you may hang up',
  'press 1',
  'press pound',
  'press 0',
  'the person you are calling is protected',
  'connect your call',
  'leave your message',
  'leave your name',
  'leave me your name',
  'leave a message',
  'leave me a message',
  'leave a detailed message',
  'give your message',
  'give me a message',
  'mailbox is full',
  "can't take your call",
  'cannot take your call',
  'stay on the line',
  "didn't get your message",
  'did not get your message',
  'were not speaking',
  'bad connection',
  'reply after the tone',
  'at the tone',
  'get back to you shortly',
  'back to you shortly',
  'as soon as possible',
];

// RingCentral sometimes transcribes an automated "the number you dialed is
// not available" readout as bare digits with no recognizable phrase at all
// (e.g. "51, 685 071 66."). A turn that is nothing but digits/punctuation is
// never real speech, so it counts as automated too.
const DIGIT_ONLY_TURN = /^[\d\s.,()-]+$/;

function isAutomatedTurn(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (DIGIT_ONLY_TURN.test(trimmed)) return true;
  const lower = trimmed.toLowerCase();
  return IVR_PHRASES.some(phrase => lower.includes(phrase));
}

export type JunkReason = 'single_speaker' | 'too_short' | 'automated_speaker';

// Below this, there's nothing to extract regardless of who's speaking.
const MIN_WORD_COUNT = 20;

// Returns why a parsed transcript looks like junk (voicemail/IVR noise,
// never a real rep-customer exchange), or null if it looks real.
//
//   - single_speaker: the whole file is one voice -- either a one-sided IVR
//     announcement or a parsing artifact. Either way, nothing to extract.
//   - too_short: fewer than MIN_WORD_COUNT spoken words total.
//   - automated_speaker: one of the (normally two) speakers said NOTHING
//     but automated/IVR-shaped text across every one of their turns -- i.e.
//     that "speaker" was a phone-system recording, not a customer who
//     actually engaged. This is the check that catches the common
//     "voicemail greeting, then the rep leaves a message" pattern, which
//     easily clears MIN_WORD_COUNT once the rep's message is chatty.
//
// Checked per-speaker (not by scanning the whole raw_text for a phrase) so
// a real, long conversation that happens to OPEN on an auto-attendant line
// before a human picks up -- e.g. "if you record your name and reason for
// calling..." followed by dozens of real exchange turns -- is correctly
// NOT flagged: that speaker's later turns are real speech, so "every turn
// automated" is false for them.
export function junkReason(parsed: ParsedRingCentralTranscript): JunkReason | null {
  if (parsed.speakers.length <= 1) return 'single_speaker';
  if (parsed.wordCount < MIN_WORD_COUNT) return 'too_short';

  for (const speaker of parsed.speakers) {
    const speakerTurns = parsed.turns.filter(t => t.speaker === speaker && t.text.trim());
    if (speakerTurns.length > 0 && speakerTurns.every(t => isAutomatedTurn(t.text))) {
      return 'automated_speaker';
    }
  }
  return null;
}

export function isLikelyJunk(parsed: ParsedRingCentralTranscript): boolean {
  return junkReason(parsed) !== null;
}

// ─── Customer identification ───────────────────────────────────────────────

// The single speaker not in the corpus-wide rep set (repDetection.ts); null
// if every speaker is a rep (rare -- e.g. an internal call) or more than one
// speaker is a non-rep (a household call transferred between two family
// members, or a corpus-frequency false positive -- see repDetection.ts's
// threshold caveat). A single ambiguous or all-rep file is not worth
// guessing on; the caller stores customer_name null and moves on.
export function pickCustomerName(parsed: ParsedRingCentralTranscript, repNames: ReadonlySet<string>): string | null {
  const nonReps = parsed.speakers.filter(name => !repNames.has(name));
  return nonReps.length === 1 ? nonReps[0] : null;
}
