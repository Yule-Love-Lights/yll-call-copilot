import { describe, expect, it } from 'vitest';
import {
  assembleCallScore,
  buildHospitalityScorecard,
  buildSalesScorecard,
  buildSystemPrompt,
  computeExperienceScore,
  computeOverall,
  DEFAULT_WEIGHTING,
  validateScore,
  type RawModelScore,
} from './score';
import type { HardMetrics } from './metrics';
import { SALES_DIM_MAX, DEFAULT_OFFER_ELEMENTS, type RubricContent } from './types';
import { SEEDED_RUBRIC } from './rubric';

function rawDim(score: number, notes = 'notes'): { score: number; notes: string } {
  return { score, notes };
}

function validRawScore(overrides: Partial<RawModelScore> = {}): RawModelScore {
  const base: RawModelScore = {
    emotional: {
      state: 'excited',
      named_back: true,
      matched_track: true,
      grade: 9,
      notes: 'Named the excitement and ran the vision-first track.',
    },
    sales: {
      opening: rawDim(12),
      discovery: rawDim(20),
      value: rawDim(15),
      objections: rawDim(15),
      close: rawDim(10),
    },
    hospitality: {
      greeting: rawDim(18),
      listening: rawDim(18),
      courtesy: rawDim(18),
      dead_air: rawDim(18, '2 gaps over 3s, totaling 6s'),
      warm_ending: rawDim(18),
    },
    hard_metrics_estimate: {
      rep_talk_ratio: 0.4,
      question_count: 3,
      dead_air_seconds: 6,
      interruption_count: 0,
      duration_seconds: 300,
    },
    experience: { cared_for: 9, at_ease: 9, excited: 9, notes: 'Warm throughout.' },
    guarantees: {
      fast_fix_48h: { applicable: true, done: true, notes: 'Said the 48-hour window.' },
      all_inclusive: { applicable: true, done: true, notes: 'Said all-inclusive.' },
      lease_disclosure: { applicable: true, done: false, notes: 'Never mentioned lease vs own.' },
      labor_warranty_3yr: { applicable: false, done: false, notes: 'Not a permanent call.' },
      referral_ask: { applicable: true, done: true, notes: 'Mentioned referral credit.' },
      rebook_lock: { applicable: false, done: false, notes: 'Not a takedown call.' },
      permanent_seed: { applicable: false, done: false, notes: 'No fit on this call.' },
    },
    fix: null,
    win: 'Read the excited buyer correctly and matched the vision-first track from the first minute.',
  };
  return { ...base, ...overrides };
}

describe('computeExperienceScore', () => {
  it('averages cared_for, at_ease, and excited', () => {
    expect(computeExperienceScore({ cared_for: 9, at_ease: 8, excited: 7 })).toBeCloseTo(8, 5);
  });
});

describe('buildSalesScorecard / buildHospitalityScorecard', () => {
  it('applies the pinned maxes and totals the dim scores, ignoring anything the model sent for max/total', () => {
    const sales = buildSalesScorecard({
      opening: rawDim(12),
      discovery: rawDim(20),
      value: rawDim(15),
      objections: rawDim(15),
      close: rawDim(10),
    });
    expect(sales).toEqual({
      opening: { score: 12, max: 15, notes: 'notes' },
      discovery: { score: 20, max: 25, notes: 'notes' },
      value: { score: 15, max: 20, notes: 'notes' },
      objections: { score: 15, max: 20, notes: 'notes' },
      close: { score: 10, max: 20, notes: 'notes' },
      total: 72,
    });
  });

  it('totals hospitality dims at their pinned max-20 each', () => {
    const hospitality = buildHospitalityScorecard({
      greeting: rawDim(18),
      listening: rawDim(18),
      courtesy: rawDim(18),
      dead_air: rawDim(18),
      warm_ending: rawDim(18),
    });
    expect(hospitality.total).toBe(90);
    expect(hospitality.greeting.max).toBe(20);
  });
});

describe('computeOverall — the pinned experience-weighted formula', () => {
  it('matches the pinned 0.40/0.35/0.25 weighting with the default weighting', () => {
    // 0.40*(9*10) + 0.35*72 + 0.25*90 = 36 + 25.2 + 22.5 = 83.7
    expect(computeOverall(9, 72, 90)).toBeCloseTo(83.7, 5);
    expect(DEFAULT_WEIGHTING).toEqual({ experience: 0.4, sales: 0.35, hospitality: 0.25 });
  });

  it('rounds to 1 decimal place', () => {
    // 0.40*(8.333...*10) + 0.35*50 + 0.25*60 = 33.333 + 17.5 + 15 = 65.833 -> 65.8
    expect(computeOverall(25 / 3, 50, 60)).toBeCloseTo(65.8, 5);
  });

  it('a warm no (high experience, low close) outscores a pushy yes (low experience, high close)', () => {
    const warmNo = computeOverall(9, 40, 88); // 0.4*90 + 0.35*40 + 0.25*88 = 36+14+22 = 72.0
    const pushyYes = computeOverall(3, 90, 50); // 0.4*30 + 0.35*90 + 0.25*50 = 12+31.5+12.5 = 56.0
    expect(warmNo).toBeCloseTo(72.0, 5);
    expect(pushyYes).toBeCloseTo(56.0, 5);
    expect(warmNo).toBeGreaterThan(pushyYes);
  });

  it('accepts a custom weighting (a Settings edit to rubric.weighting)', () => {
    const tiltedToHospitality = computeOverall(9, 40, 88, { experience: 0.2, sales: 0.2, hospitality: 0.6 });
    // 0.2*90 + 0.2*40 + 0.6*88 = 18+8+52.8 = 78.8
    expect(tiltedToHospitality).toBeCloseTo(78.8, 5);
  });
});

describe('validateScore', () => {
  it('accepts a well-formed raw model score', () => {
    const result = validateScore(validRawScore());
    expect(result.valid).toBe(true);
  });

  it('rejects an invalid emotional.state', () => {
    const result = validateScore(validRawScore({ emotional: { ...validRawScore().emotional, state: 'happy' as never } }));
    expect(result.valid).toBe(false);
  });

  it('rejects a sales scorecard missing a required dimension', () => {
    const raw = validRawScore();
    const { opening, discovery, value, objections } = raw.sales;
    const result = validateScore({ ...raw, sales: { opening, discovery, value, objections } });
    expect(result.valid).toBe(false);
  });

  it('rejects a dimension score above its pinned max', () => {
    const raw = validRawScore();
    const result = validateScore({ ...raw, sales: { ...raw.sales, opening: rawDim(999) } });
    expect(result.valid).toBe(false);
  });

  it('rejects a negative dimension score', () => {
    const raw = validRawScore();
    const result = validateScore({ ...raw, hospitality: { ...raw.hospitality, greeting: rawDim(-1) } });
    expect(result.valid).toBe(false);
  });

  it('rejects guarantees missing one of the seven required keys', () => {
    const raw = validRawScore();
    const { fast_fix_48h, all_inclusive, lease_disclosure, labor_warranty_3yr, referral_ask, rebook_lock } = raw.guarantees;
    const guaranteesWithoutSeed = { fast_fix_48h, all_inclusive, lease_disclosure, labor_warranty_3yr, referral_ask, rebook_lock };
    const result = validateScore({ ...raw, guarantees: guaranteesWithoutSeed });
    expect(result.valid).toBe(false);
  });

  it('rejects a malformed fix object (missing better_line)', () => {
    const raw = validRawScore({
      fix: { moment: 'Price stated cold', timestamp_seconds: 90, transcript_quote: 'It is $4,200.' } as never,
    });
    const result = validateScore(raw);
    expect(result.valid).toBe(false);
  });

  it('accepts a null fix (a genuinely great call)', () => {
    const result = validateScore(validRawScore({ fix: null }));
    expect(result.valid).toBe(true);
  });

  it('rejects a non-string win', () => {
    const result = validateScore(validRawScore({ win: 123 as never }));
    expect(result.valid).toBe(false);
  });

  // Fix 6: isHardMetricsEstimate used to only check isFiniteNumber, so a
  // negative question_count (etc.) passed validation and got stored.
  const negativeRejectedFields = ['question_count', 'dead_air_seconds', 'interruption_count', 'duration_seconds'] as const;
  it.each(negativeRejectedFields)('rejects a negative %s in hard_metrics_estimate', field => {
    const raw = validRawScore();
    const result = validateScore({
      ...raw,
      hard_metrics_estimate: { ...raw.hard_metrics_estimate, [field]: -3 },
    });
    expect(result.valid).toBe(false);
  });

  it('still accepts zero for each hard_metrics_estimate count/seconds field', () => {
    const raw = validRawScore();
    const result = validateScore({
      ...raw,
      hard_metrics_estimate: { rep_talk_ratio: 0, question_count: 0, dead_air_seconds: 0, interruption_count: 0, duration_seconds: 0 },
    });
    expect(result.valid).toBe(true);
  });
});

describe('assembleCallScore', () => {
  const deterministicMetrics: HardMetrics = {
    rep_talk_ratio: 0.43,
    question_count: 5,
    dead_air_seconds: 12,
    interruption_count: 2,
    duration_seconds: 480,
  };

  it('overrides the model hard_metrics estimate with the deterministic computation when utterances were available', () => {
    const raw = validRawScore();
    const assembled = assembleCallScore(raw, deterministicMetrics, false);
    expect(assembled.hard_metrics).toEqual(deterministicMetrics);
  });

  it('falls back to the model estimate and flags it in the hospitality notes when utterances were missing', () => {
    const raw = validRawScore();
    const assembled = assembleCallScore(raw, raw.hard_metrics_estimate, true);
    expect(assembled.hard_metrics).toEqual(raw.hard_metrics_estimate);
    expect(assembled.hospitality.dead_air.notes).toContain('estimated');
    expect(assembled.hospitality.listening.notes).toContain('estimated');
  });

  it('computes experience_score and overall from the assembled components', () => {
    const raw = validRawScore();
    const assembled = assembleCallScore(raw, deterministicMetrics, false);
    expect(assembled.experience_score).toBeCloseTo(9, 5);
    expect(assembled.overall).toBeCloseTo(computeOverall(9, assembled.sales.total, assembled.hospitality.total), 5);
  });

  // Fix 3(a): assembleCallScore used to call computeOverall with no
  // weighting argument at all, so a Settings edit to rubric.weighting never
  // changed the stored overall. It must now thread a custom weighting
  // through to computeOverall exactly like the default does.
  it('threads a custom weighting through to the stored overall (a Settings edit must take effect)', () => {
    const raw = validRawScore();
    const customWeighting = { experience: 0.5, sales: 0.3, hospitality: 0.2 };

    const withDefault = assembleCallScore(raw, deterministicMetrics, false);
    const withCustom = assembleCallScore(raw, deterministicMetrics, false, customWeighting);

    expect(withCustom.overall).toBeCloseTo(
      computeOverall(withCustom.experience_score, withCustom.sales.total, withCustom.hospitality.total, customWeighting),
      5,
    );
    expect(withCustom.overall).not.toBeCloseTo(withDefault.overall, 1);
  });

  it('defaults to the pinned 0.40/0.35/0.25 weighting when the caller passes none', () => {
    const raw = validRawScore();
    const assembled = assembleCallScore(raw, deterministicMetrics, false);
    expect(assembled.overall).toBeCloseTo(
      computeOverall(assembled.experience_score, assembled.sales.total, assembled.hospitality.total, DEFAULT_WEIGHTING),
      5,
    );
  });
});

// Fix 3(b): the system prompt used to tell the model "max ${d.weight}" from
// the editable rubric dims, while the emit_score validator (isRawDim, in
// this file) enforces the pinned SALES_DIM_MAX/HOSPITALITY_DIM_MAX. An
// edited dim weight made the model return scores the validator then
// rejected. The prompt must always state the pinned max, never the
// editable weight.
describe('buildSystemPrompt — dimension maxes must match the pinned validator maxes', () => {
  it('states the pinned SALES_DIM_MAX for a sales dim even when rubric.weight has been edited away from it', () => {
    const editedRubric: RubricContent = {
      ...SEEDED_RUBRIC,
      sales: SEEDED_RUBRIC.sales.map(d => (d.key === 'opening' ? { ...d, weight: 999 } : d)),
    };

    const prompt = buildSystemPrompt(editedRubric, DEFAULT_OFFER_ELEMENTS);

    expect(prompt).toContain(`opening, max ${SALES_DIM_MAX.opening}`);
    expect(prompt).not.toContain('max 999');
  });

  it('states the pinned HOSPITALITY_DIM_MAX for a hospitality dim even when rubric.weight has been edited', () => {
    const editedRubric: RubricContent = {
      ...SEEDED_RUBRIC,
      hospitality: SEEDED_RUBRIC.hospitality.map(d => (d.key === 'dead_air' ? { ...d, weight: 1 } : d)),
    };

    const prompt = buildSystemPrompt(editedRubric, DEFAULT_OFFER_ELEMENTS);

    expect(prompt).toContain('dead_air, max 20');
    expect(prompt).not.toContain('dead_air, max 1)');
  });
});
