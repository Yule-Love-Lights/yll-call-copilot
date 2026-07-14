// Pure derivation of one feedback card from a scored call
// (docs/SALES-EXCELLENCE-PLAN.md, "Coaching mechanics locked" + section 4:
// "after every call the rep gets ONE glanceable card ... lead with the win
// every time ... the score number is TUCKED INTO the expandable detail,
// never the headline"). No Claude call, no randomness -- every string here
// is either copied straight off the call_scores row or fixed connective
// phrasing, same "no invented content" rule as the rest of this workstream.
//
// headline: the upstream scorer already writes score.win in the warm,
// first-person-plural coach voice the plan's examples show ("You named her
// worry back before answering. That is exactly the standard.") -- deriveCard
// uses it verbatim rather than rewriting it, since rewriting would count as
// invented content and this function has no model call to do it faithfully
// anyway.
//
// fix: present only when score.fix is non-null (see isPraiseOnly -- the
// pinned rule is praise_only strictly equals fix === null, full stop; a real
// fix on a 90+ call is never suppressed, and no fix is ever manufactured
// when the scorer didn't produce one).
//
// detail: every dimension score/note, the hard metrics, the three
// experience feelings, and the overall/experience numbers -- this is the
// ONLY place the score number lives.

import type { CallScoreRow } from './types';

export type CardFix = {
  label: string;
  // mm:ss, or null when the scorer didn't attach a moment-in-call timestamp.
  timestamp: string | null;
  sayThis: string;
  fromTranscript: string;
};

export type CardDetail = {
  overall: number;
  experienceScore: number;
  experience: { caredFor: boolean; atEase: boolean; excited: boolean; notes: string };
  emotional: { state: string; namedBack: boolean; matchedTrack: boolean; grade: string; notes: string };
  sales: CallScoreRow['sales'];
  hospitality: {
    greeting: CallScoreRow['hospitality']['greeting'];
    listening: CallScoreRow['hospitality']['listening'];
    courtesy: CallScoreRow['hospitality']['courtesy'];
    deadAir: CallScoreRow['hospitality']['dead_air'];
    warmEnding: CallScoreRow['hospitality']['warm_ending'];
    total: number;
  };
  hardMetrics: {
    repTalkRatio: number;
    questionCount: number;
    deadAirSeconds: number;
    interruptionCount: number;
    durationSeconds: number;
  };
  guarantees: unknown;
};

export type CardContent = {
  headline: string;
  fix: CardFix | null;
  detail: CardDetail;
};

// mm:ss -- minutes unpadded, seconds zero-padded to 2 digits, matching the
// plan doc's own examples ("(11:42)", "(6:15)"). Floors fractional seconds;
// callers only ever pass a non-negative number (see deriveCard's null guard
// for the "no timestamp" case).
export function formatTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

// The single pinned rule (docs/SALES-EXCELLENCE-PLAN.md via the task brief):
// praise_only strictly equals fix === null. Never derived from overall.
export function isPraiseOnly(score: Pick<CallScoreRow, 'fix'>): boolean {
  return score.fix === null;
}

export function deriveCard(score: CallScoreRow): CardContent {
  const fix: CardFix | null = score.fix
    ? {
        label: score.fix.moment.trim(),
        timestamp:
          score.fix.timestamp_seconds !== null && Number.isFinite(score.fix.timestamp_seconds)
            ? formatTimestamp(score.fix.timestamp_seconds)
            : null,
        sayThis: score.fix.better_line,
        fromTranscript: score.fix.transcript_quote,
      }
    : null;

  return {
    headline: score.win.trim(),
    fix,
    detail: {
      overall: score.overall,
      experienceScore: score.experience_score,
      experience: {
        caredFor: score.experience.cared_for,
        atEase: score.experience.at_ease,
        excited: score.experience.excited,
        notes: score.experience.notes,
      },
      emotional: {
        state: score.emotional.state,
        namedBack: score.emotional.named_back,
        matchedTrack: score.emotional.matched_track,
        grade: score.emotional.grade,
        notes: score.emotional.notes,
      },
      sales: score.sales,
      hospitality: {
        greeting: score.hospitality.greeting,
        listening: score.hospitality.listening,
        courtesy: score.hospitality.courtesy,
        deadAir: score.hospitality.dead_air,
        warmEnding: score.hospitality.warm_ending,
        total: score.hospitality.total,
      },
      hardMetrics: {
        repTalkRatio: score.hard_metrics.rep_talk_ratio,
        questionCount: score.hard_metrics.question_count,
        deadAirSeconds: score.hard_metrics.dead_air_seconds,
        interruptionCount: score.hard_metrics.interruption_count,
        durationSeconds: score.hard_metrics.duration_seconds,
      },
      guarantees: score.guarantees,
    },
  };
}
