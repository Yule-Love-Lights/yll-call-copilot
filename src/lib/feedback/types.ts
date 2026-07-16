import type { CardContent } from './card';

// Shared shapes for Workstream 3 (automated rep feedback cards).
//
// CallScoreRow mirrors the `call_scores` table the sibling rep-scoring
// workstream ships in migration 0008 -- this is the exact contract this
// workstream builds against (see docs/SALES-EXCELLENCE-PLAN.md, "Coaching
// mechanics locked" + section 4). `guarantees` is still typed loosely
// (unknown) since deriveCard only ever passes it through into the card's
// detail section unchanged -- it never branches on a specific value -- and
// this workstream doesn't own that contract's exact keys.
//
// experience.cared_for/at_ease/excited and emotional.grade are NUMBERS
// (0-10), not booleans/strings -- fixed after an adversarial review found
// this file had them wrong (booleans/'hit'-style string) while the scorer
// (src/lib/scoring/types.ts on naldo/scoring-engine) always writes numbers.
// The old types let the UI truthiness-render a 2/10 identically to a 10/10.
//
// FeedbackCardRow mirrors supabase/migrations/0009_feedback.sql, this
// workstream's own table. Same convention as leads/types.ts and
// live/types.ts: only the columns the app reads/writes, not a full
// generated schema.

export type DimensionScore = { score: number; max: number; notes: string };

export type SalesScores = {
  opening: DimensionScore;
  discovery: DimensionScore;
  value: DimensionScore;
  objections: DimensionScore;
  close: DimensionScore;
  total: number;
};

export type HospitalityScores = {
  greeting: DimensionScore;
  listening: DimensionScore;
  courtesy: DimensionScore;
  dead_air: DimensionScore;
  warm_ending: DimensionScore;
  total: number;
};

export type HardMetrics = {
  rep_talk_ratio: number;
  question_count: number;
  dead_air_seconds: number;
  interruption_count: number;
  duration_seconds: number;
};

export type EmotionalDiagnosis = {
  state: string;
  named_back: boolean;
  matched_track: boolean;
  grade: number; // 0-10
  notes: string;
};

export type ExperienceRatings = {
  cared_for: number; // 0-10
  at_ease: number; // 0-10
  excited: number; // 0-10
  notes: string;
};

export type CallScoreFix = {
  moment: string;
  timestamp_seconds: number | null;
  transcript_quote: string;
  better_line: string;
};

export type CallScoreRow = {
  id: string;
  transcript_id: string;
  rubric_version: number;
  rep_email: string;
  vertical_slug: string;
  called_at: string;
  emotional: EmotionalDiagnosis;
  sales: SalesScores;
  hospitality: HospitalityScores;
  hard_metrics: HardMetrics;
  experience: ExperienceRatings;
  experience_score: number;
  guarantees: unknown;
  overall: number;
  // The rep's win, in warm first-person-plural coach voice, already written
  // by the upstream scorer -- deriveCard uses it verbatim as the card's
  // headline (see ./card.ts's file header for why no rewriting happens
  // here).
  win: string;
  fix: CallScoreFix | null;
  scored_at: string;
};

export type FeedbackCardRow = {
  id: string;
  call_score_id: string;
  transcript_id: string | null;
  rep_email: string | null;
  praise_only: boolean;
  // Populated by deriveCard() -- see ./card.ts for CardContent's shape.
  card: CardContent;
  seen_at: string | null;
  created_at: string;
};
