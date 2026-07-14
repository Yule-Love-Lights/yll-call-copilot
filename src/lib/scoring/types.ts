// Shared shapes for the after-every-call scoring engine (see
// docs/SALES-EXCELLENCE-PLAN.md sections 3 + 4). These jsonb shapes are a
// PINNED CONTRACT: sibling workstreams (rep digest, weekly digest,
// leaderboard) read these exact keys off call_scores rows built from them --
// never rename a key here. Row shapes mirror supabase/migrations/
// 0008_scoring.sql, same convention as playbook/types.ts and
// transcripts/types.ts (only the columns the app reads/writes).

import type { HardMetrics } from './metrics';

export type EmotionalState = 'excited' | 'busy' | 'guarded' | 'status' | 'unclear';

export type EmotionalScore = {
  state: EmotionalState;
  named_back: boolean;
  matched_track: boolean;
  grade: number; // 0-10
  notes: string;
};

export type Dim = { score: number; max: number; notes: string };

export const SALES_DIM_KEYS = ['opening', 'discovery', 'value', 'objections', 'close'] as const;
export type SalesDimKey = (typeof SALES_DIM_KEYS)[number];

// Pinned maxes -- 15/25/20/20/20, total 100. Never taken from the model;
// always applied by code (see score.ts) so total can never drift from the
// sum of the parts.
export const SALES_DIM_MAX: Record<SalesDimKey, number> = {
  opening: 15,
  discovery: 25,
  value: 20,
  objections: 20,
  close: 20,
};

export type SalesScorecard = {
  opening: Dim;
  discovery: Dim;
  value: Dim;
  objections: Dim;
  close: Dim;
  total: number; // 0-100
};

export const HOSPITALITY_DIM_KEYS = ['greeting', 'listening', 'courtesy', 'dead_air', 'warm_ending'] as const;
export type HospitalityDimKey = (typeof HOSPITALITY_DIM_KEYS)[number];

// Pinned maxes -- 20 each, total 100. Same code-applies-the-max rule as sales.
export const HOSPITALITY_DIM_MAX: Record<HospitalityDimKey, number> = {
  greeting: 20,
  listening: 20,
  courtesy: 20,
  dead_air: 20,
  warm_ending: 20,
};

export type HospitalityScorecard = {
  greeting: Dim;
  listening: Dim;
  courtesy: Dim;
  dead_air: Dim;
  warm_ending: Dim;
  total: number; // 0-100
};

export type ExperienceScore = {
  cared_for: number; // 0-10
  at_ease: number; // 0-10
  excited: number; // 0-10
  notes: string;
};

export const GUARANTEE_KEYS = [
  'fast_fix_48h',
  'all_inclusive',
  'lease_disclosure',
  'labor_warranty_3yr',
  'referral_ask',
  'rebook_lock',
  'permanent_seed',
] as const;
export type GuaranteeKey = (typeof GUARANTEE_KEYS)[number];

export type GuaranteeGrade = { applicable: boolean; done: boolean; notes: string };
export type Guarantees = Record<GuaranteeKey, GuaranteeGrade>;

export type Fix = {
  moment: string;
  timestamp_seconds: number | null;
  transcript_quote: string;
  better_line: string;
} | null;

export type CallScoreContent = {
  emotional: EmotionalScore;
  sales: SalesScorecard;
  hospitality: HospitalityScorecard;
  hard_metrics: HardMetrics;
  experience: ExperienceScore;
  experience_score: number;
  guarantees: Guarantees | null;
  overall: number;
  win: string;
  fix: Fix;
};

export type CallScoreRow = CallScoreContent & {
  id: string;
  transcript_id: string;
  rubric_version: number;
  rep_email: string | null;
  vertical_slug: string | null;
  called_at: string | null;
  scored_at: string;
};

// ─── Rubric (Settings-editable, versioned like playbooks) ──────────────────

export type RubricDim = { key: string; name: string; weight: number; instructions: string };

export type RubricContent = {
  master: string;
  sales: RubricDim[];
  hospitality: RubricDim[];
  experience: { instructions: string };
  guarantees_note: string;
  hard_metrics: { rep_talk_ratio_target: number };
  weighting: { experience: number; sales: number; hospitality: number };
};

export type RubricSource = 'seeded' | 'edited';

export type RubricVersionRow = {
  id: string;
  version: number;
  content: RubricContent;
  source: RubricSource;
  created_at: string;
};

// ─── Offer elements (the guarantees the rep can say on a call) ─────────────
// Read at score time from `offer_versions` (content = { elements: [...] }),
// which ships in sibling migration 0014 -- until then (and whenever the read
// fails with isMissingTableError or returns nothing), DEFAULT_OFFER_ELEMENTS
// below is the fallback so scoring never blocks on that table's existence.

export type OfferElement = {
  key: GuaranteeKey;
  name: string;
  customer_line: string;
  grade_hint: string;
  applies_to: string; // plain-English scope hint fed to the model, e.g. "holiday calls only"
  situational: boolean; // true = only applicable when the fit is actually there (e.g. permanent_seed)
};

export const DEFAULT_OFFER_ELEMENTS: OfferElement[] = [
  {
    key: 'fast_fix_48h',
    name: '48-hour fast-fix guarantee',
    customer_line:
      'If any section of your display goes dark between Thanksgiving and New Year’s, we fix it within 48 hours or your month is free.',
    grade_hint: 'Said the 48-hour number out loud, not just "we’ll take care of it."',
    applies_to: 'holiday calls',
    situational: false,
  },
  {
    key: 'all_inclusive',
    name: 'All-inclusive pricing',
    customer_line: 'Design, install, all-season service, takedown, and storage are all in the number. The quote is the bill, no hidden fees.',
    grade_hint: 'Said the price is all-inclusive, not just quoted a number.',
    applies_to: 'any call where price comes up',
    situational: false,
  },
  {
    key: 'lease_disclosure',
    name: 'Lease vs. own disclosure',
    customer_line: 'We own, store, and reuse the lights; you’re buying a done-for-you display, not hardware.',
    grade_hint: 'Plainly said the lights are leased, not sold, before the customer had to ask.',
    applies_to: 'holiday calls',
    situational: false,
  },
  {
    key: 'labor_warranty_3yr',
    name: '3-year permanent labor warranty',
    customer_line: 'Permanent lighting comes with 3 years of labor coverage, not just parts.',
    grade_hint: 'Named the 3-year labor number, not just "lifetime warranty."',
    applies_to: 'permanent lighting calls',
    situational: false,
  },
  {
    key: 'referral_ask',
    name: 'Referral offer',
    customer_line: '$100 credit for you, plus two free spritzers for the friend you send our way.',
    grade_hint: 'Mentioned the referral credit to a happy customer.',
    applies_to: 'calls with a happy or booked customer',
    situational: false,
  },
  {
    key: 'rebook_lock',
    name: 'Rebook lock',
    customer_line: 'We can hold your spot and this year’s price for next season right now.',
    grade_hint: 'Offered to lock next year’s date and price, typically at takedown.',
    applies_to: 'takedown or season-end calls',
    situational: false,
  },
  {
    key: 'permanent_seed',
    name: 'Permanent-lighting seed',
    customer_line: 'Since our crew is already on your roofline, want me to have them measure for permanent while they’re up there? No cost, no commitment.',
    grade_hint: 'Planted the permanent seed only where it actually fit (past holiday customer, takedown call, a ladder-averse homeowner) -- never forced on an unrelated call.',
    applies_to: 'situational: a booked holiday customer, a takedown call, or a ladder-averse homeowner',
    situational: true,
  },
];
