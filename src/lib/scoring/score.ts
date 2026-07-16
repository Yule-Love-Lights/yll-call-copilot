// Scores one substantive call against the active rubric using Claude's
// tool-use pattern to force structured output -- one tool (emit_score) whose
// input_schema mirrors the pinned CallScoreContent shape (types.ts), with
// tool_choice forcing that tool. Mirrors the normalize+validate+single-retry
// pattern proven in src/lib/playbook/generate.ts and
// src/lib/transcripts/extract.ts/distill.ts.
//
// The model is never trusted for arithmetic: it returns per-dimension
// {score, notes} pairs only (never max/total/experience_score/overall,
// which are pure functions of those scores) and a best-effort hard_metrics
// estimate (used only when transcripts.utterances is null). Code always
// computes total/experience_score/overall and always prefers the
// deterministic utterance-based hard_metrics when available -- same
// never-trust-model-arithmetic-for-a-sum rule this codebase already applies
// to money totals.

import Anthropic from '@anthropic-ai/sdk';
import { getClaudeClient } from '../claude';
import { truncateTranscript } from '../transcripts/extract';
import type { Playbook } from '../playbook/types';
import type { HardMetrics } from './metrics';
import {
  GUARANTEE_KEYS,
  HOSPITALITY_DIM_KEYS,
  HOSPITALITY_DIM_MAX,
  SALES_DIM_KEYS,
  SALES_DIM_MAX,
  type CallScoreContent,
  type Dim,
  type EmotionalScore,
  type EmotionalState,
  type ExperienceScore,
  type Fix,
  type Guarantees,
  type HospitalityDimKey,
  type HospitalityScorecard,
  type OfferElement,
  type RubricContent,
  type SalesDimKey,
  type SalesScorecard,
} from './types';

// Single exported const for the model id -- bump here, nowhere else, if the
// model ever changes. Sonnet: this runs per substantive call (not per-token
// cheap like extraction, but scoring quality matters more than Haiku-level
// cost here, same reasoning as DISTILL_MODEL).
export const SCORE_MODEL = 'claude-sonnet-5';

// ─── The raw shape asked of / returned by the model ────────────────────────

type RawDim = { score: number; notes: string };
export type RawSales = Record<SalesDimKey, RawDim>;
export type RawHospitality = Record<HospitalityDimKey, RawDim>;
export type RawExperience = { cared_for: number; at_ease: number; excited: number; notes: string };

export type RawModelScore = {
  emotional: EmotionalScore;
  sales: RawSales;
  hospitality: RawHospitality;
  hard_metrics_estimate: HardMetrics;
  experience: RawExperience;
  guarantees: Guarantees;
  fix: Fix;
  win: string;
};

// ─── Pure assembly: dim scorecards, experience score, the overall formula ──

export function buildSalesScorecard(raw: RawSales): SalesScorecard {
  const dims = {} as Record<SalesDimKey, Dim>;
  for (const key of SALES_DIM_KEYS) {
    dims[key] = { score: raw[key].score, max: SALES_DIM_MAX[key], notes: raw[key].notes };
  }
  const total = SALES_DIM_KEYS.reduce((sum, key) => sum + dims[key].score, 0);
  return { ...dims, total } as SalesScorecard;
}

export function buildHospitalityScorecard(raw: RawHospitality): HospitalityScorecard {
  const dims = {} as Record<HospitalityDimKey, Dim>;
  for (const key of HOSPITALITY_DIM_KEYS) {
    dims[key] = { score: raw[key].score, max: HOSPITALITY_DIM_MAX[key], notes: raw[key].notes };
  }
  const total = HOSPITALITY_DIM_KEYS.reduce((sum, key) => sum + dims[key].score, 0);
  return { ...dims, total } as HospitalityScorecard;
}

export function computeExperienceScore(experience: Pick<ExperienceScore, 'cared_for' | 'at_ease' | 'excited'>): number {
  return (experience.cared_for + experience.at_ease + experience.excited) / 3;
}

export type OverallWeighting = { experience: number; sales: number; hospitality: number };

// The pinned formula's default weighting -- matches rubric_versions version 1
// (0008_scoring.sql). A Settings edit to the active rubric's `weighting`
// field is passed in by the caller (score.ts's scoreCall / batch.ts) instead
// of this default, so "the coach grades against the new standard" (the
// plan's own governance line) actually takes effect on future scores.
export const DEFAULT_WEIGHTING: OverallWeighting = { experience: 0.4, sales: 0.35, hospitality: 0.25 };

// overall = weighting.experience*(experience_score*10) + weighting.sales*sales.total + weighting.hospitality*hospitality.total,
// rounded to 1 decimal. Pinned shape; only the weights are ever tunable.
export function computeOverall(
  experienceScore: number,
  salesTotal: number,
  hospitalityTotal: number,
  weighting: OverallWeighting = DEFAULT_WEIGHTING,
): number {
  const raw =
    weighting.experience * (experienceScore * 10) + weighting.sales * salesTotal + weighting.hospitality * hospitalityTotal;
  return Math.round(raw * 10) / 10;
}

// Flag appended to the two hospitality dims whose notes are contractually
// required to carry hard numbers (dead_air, listening) when hard_metrics
// came from the model's best-effort text estimate rather than deterministic
// utterance math -- the "a flag in notes when [utterances is null]" the
// workstream spec calls for, placed here since hard_metrics itself has no
// notes field of its own in the pinned contract.
const ESTIMATED_METRICS_FLAG = ' (estimated: no diarized utterances available for this call)';

// Combines the model's raw, validated output with the deterministically
// computed (or, when utterances is null, model-estimated) hard_metrics into
// the final, pinned CallScoreContent shape. `hardMetrics` is whichever the
// caller already decided to use; `isEstimated` only controls the notes flag.
// `weighting` defaults to the pinned 0.40/0.35/0.25 split but the caller
// (scoreCall, below) passes the active rubric's own weighting so a Settings
// edit to it actually changes the stored overall.
export function assembleCallScore(
  raw: RawModelScore,
  hardMetrics: HardMetrics,
  isEstimated: boolean,
  weighting: OverallWeighting = DEFAULT_WEIGHTING,
): CallScoreContent {
  const sales = buildSalesScorecard(raw.sales);
  const hospitalityRaw = buildHospitalityScorecard(raw.hospitality);
  const hospitality: HospitalityScorecard = isEstimated
    ? {
        ...hospitalityRaw,
        dead_air: { ...hospitalityRaw.dead_air, notes: hospitalityRaw.dead_air.notes + ESTIMATED_METRICS_FLAG },
        listening: { ...hospitalityRaw.listening, notes: hospitalityRaw.listening.notes + ESTIMATED_METRICS_FLAG },
      }
    : hospitalityRaw;

  const experience: ExperienceScore = {
    cared_for: raw.experience.cared_for,
    at_ease: raw.experience.at_ease,
    excited: raw.experience.excited,
    notes: raw.experience.notes,
  };
  const experienceScore = computeExperienceScore(experience);
  const overall = computeOverall(experienceScore, sales.total, hospitality.total, weighting);

  return {
    emotional: raw.emotional,
    sales,
    hospitality,
    hard_metrics: hardMetrics,
    experience,
    experience_score: experienceScore,
    guarantees: raw.guarantees,
    overall,
    win: raw.win,
    fix: raw.fix,
  };
}

// ─── Validation ─────────────────────────────────────────────────────────────

const EMOTIONAL_STATES: EmotionalState[] = ['excited', 'busy', 'guarded', 'status', 'unclear'];

function isString(v: unknown): v is string {
  return typeof v === 'string';
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function isEmotional(v: unknown): v is EmotionalScore {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.state === 'string' &&
    (EMOTIONAL_STATES as string[]).includes(e.state) &&
    isBoolean(e.named_back) &&
    isBoolean(e.matched_track) &&
    isFiniteNumber(e.grade) &&
    e.grade >= 0 &&
    e.grade <= 10 &&
    isString(e.notes)
  );
}

function isRawDim(v: unknown, max: number): v is RawDim {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  return isFiniteNumber(d.score) && d.score >= 0 && d.score <= max && isString(d.notes);
}

function isRawSales(v: unknown): v is RawSales {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return SALES_DIM_KEYS.every(key => isRawDim(s[key], SALES_DIM_MAX[key]));
}

function isRawHospitality(v: unknown): v is RawHospitality {
  if (typeof v !== 'object' || v === null) return false;
  const h = v as Record<string, unknown>;
  return HOSPITALITY_DIM_KEYS.every(key => isRawDim(h[key], HOSPITALITY_DIM_MAX[key]));
}

function isHardMetricsEstimate(v: unknown): v is HardMetrics {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  return (
    isFiniteNumber(m.rep_talk_ratio) &&
    m.rep_talk_ratio >= 0 &&
    m.rep_talk_ratio <= 1 &&
    isFiniteNumber(m.question_count) &&
    m.question_count >= 0 &&
    isFiniteNumber(m.dead_air_seconds) &&
    m.dead_air_seconds >= 0 &&
    isFiniteNumber(m.interruption_count) &&
    m.interruption_count >= 0 &&
    isFiniteNumber(m.duration_seconds) &&
    m.duration_seconds >= 0
  );
}

function isRawExperience(v: unknown): v is RawExperience {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  const inRange = (n: unknown) => isFiniteNumber(n) && n >= 0 && n <= 10;
  return inRange(e.cared_for) && inRange(e.at_ease) && inRange(e.excited) && isString(e.notes);
}

function isGuaranteeGrade(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const g = v as Record<string, unknown>;
  return isBoolean(g.applicable) && isBoolean(g.done) && isString(g.notes);
}

function isGuarantees(v: unknown): v is Guarantees {
  if (typeof v !== 'object' || v === null) return false;
  const g = v as Record<string, unknown>;
  return GUARANTEE_KEYS.every(key => isGuaranteeGrade(g[key]));
}

function isFix(v: unknown): v is Fix {
  if (v === null) return true;
  if (typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  return (
    isString(f.moment) &&
    (f.timestamp_seconds === null || isFiniteNumber(f.timestamp_seconds)) &&
    isString(f.transcript_quote) &&
    isString(f.better_line)
  );
}

export type ScoreValidationResult = { valid: true; score: RawModelScore } | { valid: false; error: string };

export function validateScore(value: unknown): ScoreValidationResult {
  if (typeof value !== 'object' || value === null) {
    return { valid: false, error: 'Result must be an object.' };
  }
  const v = value as Record<string, unknown>;

  if (!isEmotional(v.emotional)) {
    return { valid: false, error: 'emotional must be { state, named_back, matched_track, grade (0-10), notes }.' };
  }
  if (!isRawSales(v.sales)) {
    return {
      valid: false,
      error: `sales must have all five dims (${SALES_DIM_KEYS.join(', ')}) each with score (within its max) and notes.`,
    };
  }
  if (!isRawHospitality(v.hospitality)) {
    return {
      valid: false,
      error: `hospitality must have all five dims (${HOSPITALITY_DIM_KEYS.join(', ')}) each with score 0-20 and notes.`,
    };
  }
  if (!isHardMetricsEstimate(v.hard_metrics_estimate)) {
    return {
      valid: false,
      error: 'hard_metrics_estimate must have rep_talk_ratio (0-1), question_count, dead_air_seconds, interruption_count, duration_seconds.',
    };
  }
  if (!isRawExperience(v.experience)) {
    return { valid: false, error: 'experience must be { cared_for, at_ease, excited } (0-10) and notes.' };
  }
  if (!isGuarantees(v.guarantees)) {
    return { valid: false, error: `guarantees must include all seven keys (${GUARANTEE_KEYS.join(', ')}), each { applicable, done, notes }.` };
  }
  if (!isFix(v.fix)) {
    return { valid: false, error: 'fix must be null or { moment, timestamp_seconds, transcript_quote, better_line }.' };
  }
  if (!isString(v.win)) {
    return { valid: false, error: 'win must be a string.' };
  }

  return {
    valid: true,
    score: {
      emotional: v.emotional as EmotionalScore,
      sales: v.sales as RawSales,
      hospitality: v.hospitality as RawHospitality,
      hard_metrics_estimate: v.hard_metrics_estimate as HardMetrics,
      experience: v.experience as RawExperience,
      guarantees: v.guarantees as Guarantees,
      fix: v.fix as Fix,
      win: v.win as string,
    },
  };
}

// ─── The Claude call ────────────────────────────────────────────────────────

const EMIT_SCORE_TOOL: Anthropic.Tool = {
  name: 'emit_score',
  description: 'Return the structured call score for this transcript.',
  input_schema: {
    type: 'object',
    properties: {
      emotional: {
        type: 'object',
        description: 'The master dimension, graded first: did the rep read the customer\'s emotional state, name it back, and run the matching track?',
        properties: {
          state: { type: 'string', enum: EMOTIONAL_STATES, description: 'Which of the four states (or unclear) the customer was in.' },
          named_back: { type: 'boolean', description: 'Did the rep name the state back to the customer in their own words?' },
          matched_track: { type: 'boolean', description: 'Did the rep run the matching track for that state?' },
          grade: { type: 'number', description: '0-10.' },
          notes: { type: 'string' },
        },
        required: ['state', 'named_back', 'matched_track', 'grade', 'notes'],
      },
      sales: {
        type: 'object',
        description: 'Score, out of each dimension\'s max, plus notes. Never include a max or a total -- only score and notes.',
        properties: Object.fromEntries(
          SALES_DIM_KEYS.map(key => [
            key,
            {
              type: 'object',
              properties: {
                score: { type: 'number', description: `0-${SALES_DIM_MAX[key]}.` },
                notes: { type: 'string' },
              },
              required: ['score', 'notes'],
            },
          ]),
        ),
        required: [...SALES_DIM_KEYS],
      },
      hospitality: {
        type: 'object',
        description: 'Score 0-20 per dimension, plus notes. dead_air and listening notes must carry hard numbers (counts/seconds), never vibes.',
        properties: Object.fromEntries(
          HOSPITALITY_DIM_KEYS.map(key => [
            key,
            {
              type: 'object',
              properties: {
                score: { type: 'number', description: '0-20.' },
                notes: { type: 'string' },
              },
              required: ['score', 'notes'],
            },
          ]),
        ),
        required: [...HOSPITALITY_DIM_KEYS],
      },
      hard_metrics_estimate: {
        type: 'object',
        description:
          'Your best-effort estimate from reading the transcript. Only used if diarized timing data is unavailable for this call. rep_talk_ratio and question_count can be estimated from who says what; if you cannot tell dead_air_seconds, interruption_count, or duration_seconds from the text alone, return 0 rather than guessing.',
        properties: {
          rep_talk_ratio: { type: 'number', description: '0-1, the rep share of speaking.' },
          question_count: { type: 'number' },
          dead_air_seconds: { type: 'number' },
          interruption_count: { type: 'number' },
          duration_seconds: { type: 'number' },
        },
        required: ['rep_talk_ratio', 'question_count', 'dead_air_seconds', 'interruption_count', 'duration_seconds'],
      },
      experience: {
        type: 'object',
        description: 'The 10/10 north star: did the customer feel cared for, at ease and confident, and excited about the vision -- regardless of whether they bought today.',
        properties: {
          cared_for: { type: 'number', description: '0-10.' },
          at_ease: { type: 'number', description: '0-10.' },
          excited: { type: 'number', description: '0-10.' },
          notes: { type: 'string' },
        },
        required: ['cared_for', 'at_ease', 'excited', 'notes'],
      },
      guarantees: {
        type: 'object',
        description: 'Grade every offer element listed in the prompt. applicable must be false (not a guess of true) for any element that plainly does not fit this call -- never grade an inapplicable element as done.',
        properties: Object.fromEntries(
          GUARANTEE_KEYS.map(key => [
            key,
            {
              type: 'object',
              properties: {
                applicable: { type: 'boolean' },
                done: { type: 'boolean' },
                notes: { type: 'string' },
              },
              required: ['applicable', 'done', 'notes'],
            },
          ]),
        ),
        required: [...GUARANTEE_KEYS],
      },
      fix: {
        anyOf: [
          {
            type: 'object',
            properties: {
              moment: { type: 'string' },
              timestamp_seconds: { anyOf: [{ type: 'number' }, { type: 'null' }] },
              transcript_quote: { type: 'string', description: 'Quote the actual transcript line, never invented.' },
              better_line: { type: 'string' },
            },
            required: ['moment', 'timestamp_seconds', 'transcript_quote', 'better_line'],
          },
          { type: 'null' },
        ],
        description: 'The single most useful missed moment, timestamped and quoted. Null for a genuinely great call -- pure praise, no manufactured criticism.',
      },
      win: {
        type: 'string',
        description: 'One sentence: the thing this rep did best on this call, citing what was actually said.',
      },
    },
    required: ['emotional', 'sales', 'hospitality', 'hard_metrics_estimate', 'experience', 'guarantees', 'fix', 'win'],
  },
};

// Exported for tests: the "max N" the prompt states for each dim must always
// come from the pinned SALES_DIM_MAX/HOSPITALITY_DIM_MAX constants, never
// from the editable rubric.weight -- otherwise a Settings edit to a
// dimension's weight tells the model a cap the validator (isRawDim, above)
// does not actually enforce, and the call either gets its score rejected or
// the edit is silently inert. The `?? d.weight` fallback only matters for a
// non-standard dim key outside the pinned five, which the emit_score tool
// schema (built from SALES_DIM_KEYS/HOSPITALITY_DIM_KEYS, not from the
// rubric) never actually scores anyway.
export function buildSystemPrompt(rubric: RubricContent, offerElements: OfferElement[]): string {
  const salesLines = rubric.sales
    .map(d => `- ${d.name} (${d.key}, max ${SALES_DIM_MAX[d.key as SalesDimKey] ?? d.weight}): ${d.instructions}`)
    .join('\n');
  const hospitalityLines = rubric.hospitality
    .map(d => `- ${d.name} (${d.key}, max ${HOSPITALITY_DIM_MAX[d.key as HospitalityDimKey] ?? d.weight}): ${d.instructions}`)
    .join('\n');
  const offerLines = offerElements
    .map(
      o =>
        `- ${o.key}: "${o.customer_line}" -- applies to ${o.applies_to}${o.situational ? ' (situational: grade applicable=false unless the fit is really there)' : ''}. ${o.grade_hint}`,
    )
    .join('\n');

  return `You are a veteran phone-sales coach for Yule Love Lights, a residential and commercial lighting company. You grade one real sales call transcript against the company's two-sided, experience-weighted rubric. A warm no must be able to outscore a pushy yes -- the emotional read and the hospitality side matter more than whether the deal closed today.

Master dimension (grade first): ${rubric.master}

Sales dimensions:
${salesLines}

Hospitality dimensions:
${hospitalityLines}

Experience (the 10/10 north star): ${rubric.experience.instructions}

Guarantees to grade (only when they actually fit this call):
${offerLines}

${rubric.guarantees_note}

Cite the transcript, never invent a line, a phrase, or an objection that is not there. The fix moment must be a real quote from the transcript. Never use an em dash. Never use the words "unlock", "leverage", or "delve".

In the emit_score tool call, every field must be real JSON of its declared type. Never JSON-encode a value as a string and never wrap it in XML tags.`;
}

function buildUserPrompt(input: {
  verticalName: string;
  playbook: Playbook | null;
  rawText: string;
  utterancesAvailable: boolean;
}): string {
  return [
    `Vertical: ${input.verticalName}`,
    '',
    input.playbook ? `Current playbook for this vertical:\n${JSON.stringify(input.playbook, null, 2)}` : '(no active playbook for this vertical)',
    '',
    input.utterancesAvailable
      ? 'Diarized timing data is available for this call; your hard_metrics_estimate will only be used as a fallback and is unlikely to be needed.'
      : 'No diarized timing data is available for this call -- your hard_metrics_estimate for rep_talk_ratio and question_count will be used directly. Return 0 for dead_air_seconds, interruption_count, and duration_seconds since those cannot be estimated from text alone.',
    '',
    'Call transcript:',
    truncateTranscript(input.rawText),
    '',
    'Score this call now.',
  ].join('\n');
}

export type ScoreCallInput = {
  verticalName: string;
  rubric: RubricContent;
  playbook: Playbook | null;
  offerElements: OfferElement[];
  rawText: string;
  // The deterministic, utterance-derived hard metrics (see metrics.ts). Only
  // used when utterancesAvailable is true -- otherwise the model's own
  // validated hard_metrics_estimate is used instead, so any placeholder
  // value is fine here when utterances are unavailable.
  hardMetrics: HardMetrics;
  utterancesAvailable: boolean;
};

const MAX_ATTEMPTS = 2;
const MAX_TOKENS = 8000;

export async function scoreCall(input: ScoreCallInput): Promise<CallScoreContent> {
  const client = getClaudeClient();
  if (!client) {
    throw new Error('Claude not configured. Set ANTHROPIC_API_KEY in .env.local');
  }

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: buildUserPrompt({
        verticalName: input.verticalName,
        playbook: input.playbook,
        rawText: input.rawText,
        utterancesAvailable: input.utterancesAvailable,
      }),
    },
  ];

  const system = buildSystemPrompt(input.rubric, input.offerElements);

  let lastError = 'unknown validation error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      model: SCORE_MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [EMIT_SCORE_TOOL],
      tool_choice: { type: 'tool', name: 'emit_score' },
      messages,
    });

    if (response.stop_reason === 'max_tokens') {
      throw new Error('Call scoring ran past the token limit; nothing was saved.');
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === 'emit_score',
    );
    if (!toolUse) {
      throw new Error('Claude did not return a score.');
    }

    const checked = validateScore(toolUse.input);
    if (checked.valid) {
      // Prefer the deterministic, utterance-derived hardMetrics the caller
      // computed; fall back to the model's own validated estimate only when
      // utterances were unavailable to compute one from in the first place.
      const hardMetrics = input.utterancesAvailable ? input.hardMetrics : checked.score.hard_metrics_estimate;
      return assembleCallScore(checked.score, hardMetrics, !input.utterancesAvailable, input.rubric.weighting);
    }
    lastError = checked.error;

    if (attempt < MAX_ATTEMPTS) {
      const allToolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      messages.push(
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: allToolUses.map(block => ({
            type: 'tool_result' as const,
            tool_use_id: block.id,
            is_error: true,
            content: `That score was rejected: ${checked.error} Call emit_score again with every field as real JSON of its declared type.`,
          })),
        },
      );
    }
  }

  throw new Error(`Claude returned an invalid score (${lastError}); nothing was saved.`);
}
