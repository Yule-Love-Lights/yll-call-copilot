// Pure utterance math for the scoring engine's hard_metrics: talk ratio,
// dead air, interruptions, question count, duration -- all computed
// deterministically from transcripts.utterances (a sibling workstream's
// diarized [{speaker,start,end,text}] column, see score.ts for the
// null-utterances fallback). No Claude call here; this is the "code, not
// model" half of hard_metrics.

export type Utterance = { speaker: string; start: number; end: number; text: string };

export type HardMetrics = {
  rep_talk_ratio: number; // 0-1
  question_count: number;
  dead_air_seconds: number;
  interruption_count: number;
  duration_seconds: number;
};

// A gap between consecutive utterances longer than this counts as dead air.
const DEAD_AIR_THRESHOLD_SECONDS = 3;
// An utterance starting more than this long before the previous one ends
// counts as an interruption.
const INTERRUPTION_THRESHOLD_SECONDS = 0.5;

const ZERO_METRICS: HardMetrics = {
  rep_talk_ratio: 0,
  question_count: 0,
  dead_air_seconds: 0,
  interruption_count: 0,
  duration_seconds: 0,
};

// DEVIATION (logged, see the workstream report): the pinned utterances
// contract is {speaker,start,end,text} with no explicit rep/customer role
// field, and sibling migration 0007 (utterances column) had not landed a
// role convention as of this build. Simplest defensible heuristic
// consistent with the phone standard's own opening step ("branded warm
// greeting" -- the rep speaks first): the first speaker to talk is the rep.
// Swap this for an explicit role field the moment one exists upstream.
export function identifyRepSpeaker(utterances: Utterance[]): string | null {
  return utterances.length > 0 ? utterances[0].speaker : null;
}

function duration(u: Utterance): number {
  return Math.max(0, u.end - u.start);
}

// Splits an utterance's text into sentence-shaped chunks on ., ?, ! so a
// multi-sentence turn (a rep both stating something and asking a follow-up
// question in the same breath) counts every real question, not just
// whether the whole turn happens to end in "?".
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function countQuestions(utterances: Utterance[], repSpeaker: string | null): number {
  if (!repSpeaker) return 0;
  let count = 0;
  for (const u of utterances) {
    if (u.speaker !== repSpeaker) continue;
    for (const sentence of sentences(u.text)) {
      if (sentence.endsWith('?')) count++;
    }
  }
  return count;
}

export function computeHardMetrics(utterances: Utterance[]): HardMetrics {
  if (utterances.length === 0) return { ...ZERO_METRICS };

  const ordered = [...utterances].sort((a, b) => a.start - b.start);
  const repSpeaker = identifyRepSpeaker(utterances);

  let repDuration = 0;
  let totalDuration = 0;
  let deadAirSeconds = 0;
  let interruptionCount = 0;

  for (let i = 0; i < ordered.length; i++) {
    const u = ordered[i];
    const d = duration(u);
    totalDuration += d;
    if (u.speaker === repSpeaker) repDuration += d;

    if (i > 0) {
      const prev = ordered[i - 1];
      const gap = u.start - prev.end;
      if (gap > DEAD_AIR_THRESHOLD_SECONDS) deadAirSeconds += gap;
      if (prev.end - u.start > INTERRUPTION_THRESHOLD_SECONDS) interruptionCount++;
    }
  }

  const firstStart = ordered[0].start;
  const lastEnd = Math.max(...ordered.map(u => u.end));

  return {
    rep_talk_ratio: totalDuration > 0 ? repDuration / totalDuration : 0,
    question_count: countQuestions(utterances, repSpeaker),
    dead_air_seconds: deadAirSeconds,
    interruption_count: interruptionCount,
    duration_seconds: Math.max(0, lastEnd - firstStart),
  };
}
