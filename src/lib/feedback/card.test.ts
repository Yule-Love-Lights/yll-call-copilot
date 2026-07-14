// Coverage for deriveCard, formatTimestamp, and isPraiseOnly -- the pure
// card-derivation rules from docs/SALES-EXCELLENCE-PLAN.md's "Coaching
// mechanics locked" section: lead with the win, at most one fix with the
// exact line + timestamp, the score tucked into detail only, no manufactured
// criticism on a real praise-only call.

import { describe, it, expect } from 'vitest';
import { deriveCard, formatTimestamp, isPraiseOnly } from './card';
import type { CallScoreRow } from './types';

function baseScore(overrides: Partial<CallScoreRow> = {}): CallScoreRow {
  return {
    id: 'score-1',
    transcript_id: 'transcript-1',
    rubric_version: 1,
    rep_email: 'jason@example.com',
    vertical_slug: 'holiday',
    called_at: '2026-07-10T18:00:00.000Z',
    emotional: {
      state: 'excited',
      named_back: true,
      matched_track: true,
      grade: 'hit',
      notes: 'Named the excitement back in the first thirty seconds.',
    },
    sales: {
      opening: { score: 14, max: 15, notes: 'Warm, branded greeting.' },
      discovery: { score: 20, max: 25, notes: 'Asked the occasion and the why.' },
      value: { score: 18, max: 20, notes: 'Stacked value before the number.' },
      objections: { score: 16, max: 20, notes: 'Used the playbook response.' },
      close: { score: 18, max: 20, notes: 'Asked for the booking with a binary choice.' },
      total: 86,
    },
    hospitality: {
      greeting: { score: 9, max: 10, notes: 'Company + first name + open question.' },
      listening: { score: 10, max: 10, notes: 'Never interrupted.' },
      courtesy: { score: 9, max: 10, notes: '"My pleasure" used naturally.' },
      dead_air: { score: 8, max: 10, notes: 'One long pause at 4:10.' },
      warm_ending: { score: 10, max: 10, notes: 'Left the door open by name.' },
      total: 46,
    },
    hard_metrics: {
      rep_talk_ratio: 0.44,
      question_count: 6,
      dead_air_seconds: 12,
      interruption_count: 0,
      duration_seconds: 540,
    },
    experience: {
      cared_for: true,
      at_ease: true,
      excited: true,
      notes: 'All three signature feelings landed.',
    },
    experience_score: 95,
    guarantees: { fortyEightHourFix: true, allInclusive: true, referral: false },
    overall: 87,
    win: 'You named her excitement back before pitching a single thing. That is exactly the standard.',
    fix: {
      moment: 'Referral credit never mentioned to a happy customer',
      timestamp_seconds: 702,
      transcript_quote: "That sounds perfect, thank you so much!",
      better_line: 'Before we hang up, if any neighbors ever ask, we give you $100 and them two free spritzers.',
    },
    scored_at: '2026-07-10T18:12:00.000Z',
    ...overrides,
  };
}

describe('formatTimestamp', () => {
  it('formats seconds under a minute', () => {
    expect(formatTimestamp(0)).toBe('0:00');
    expect(formatTimestamp(42)).toBe('0:42');
  });

  it('pads seconds but not minutes', () => {
    expect(formatTimestamp(65)).toBe('1:05');
    expect(formatTimestamp(375)).toBe('6:15');
    expect(formatTimestamp(702)).toBe('11:42');
  });

  it('floors fractional seconds', () => {
    expect(formatTimestamp(65.9)).toBe('1:05');
  });
});

describe('isPraiseOnly', () => {
  it('is true when fix is null', () => {
    expect(isPraiseOnly({ fix: null })).toBe(true);
  });

  it('is true for a real fix at any score, per the pinned rule (praise_only strictly = fix == null)', () => {
    // A 95-overall call with a real fix is still NOT praise_only -- the spec
    // explicitly rules out an "overall >= 90 suppresses the fix" branch.
    expect(isPraiseOnly({ fix: { moment: 'x', timestamp_seconds: null, transcript_quote: 'x', better_line: 'x' } })).toBe(false);
  });
});

describe('deriveCard', () => {
  it('uses win verbatim as the headline', () => {
    const score = baseScore();
    const card = deriveCard(score);
    expect(card.headline).toBe(score.win);
  });

  it('never puts a number in the headline -- the score stays tucked in detail', () => {
    const score = baseScore();
    const card = deriveCard(score);
    expect(card.headline).not.toMatch(/\d/);
    expect(card.headline).not.toContain(String(score.overall));
  });

  it('omits the fix section entirely when score.fix is null (praise-only, no manufactured criticism)', () => {
    const score = baseScore({ fix: null });
    const card = deriveCard(score);
    expect(card.fix).toBeNull();
  });

  it('includes a real fix the scorer produced, even on a high-scoring call', () => {
    const score = baseScore({ overall: 96 });
    const card = deriveCard(score);
    expect(card.fix).not.toBeNull();
  });

  it('builds the fix section from the score row with no invented content', () => {
    const score = baseScore();
    const card = deriveCard(score);
    expect(card.fix).toEqual({
      label: 'Referral credit never mentioned to a happy customer',
      timestamp: '11:42',
      sayThis: score.fix!.better_line,
      fromTranscript: score.fix!.transcript_quote,
    });
  });

  it('omits the timestamp when timestamp_seconds is null', () => {
    const score = baseScore({
      fix: {
        moment: 'Price stated before any value stack',
        timestamp_seconds: null,
        transcript_quote: 'So what would this run me?',
        better_line: 'Two-sentence value recap, then the number.',
      },
    });
    const card = deriveCard(score);
    expect(card.fix?.timestamp).toBeNull();
  });

  it('tucks the score and every numeric/detail field into detail, never the headline or fix label', () => {
    const score = baseScore();
    const card = deriveCard(score);
    expect(card.detail.overall).toBe(87);
    expect(card.detail.experienceScore).toBe(95);
    expect(card.detail.experience).toEqual({ caredFor: true, atEase: true, excited: true, notes: score.experience.notes });
    expect(card.detail.emotional).toEqual({
      state: 'excited',
      namedBack: true,
      matchedTrack: true,
      grade: 'hit',
      notes: score.emotional.notes,
    });
    expect(card.detail.sales).toEqual(score.sales);
    expect(card.detail.hospitality).toEqual({
      greeting: score.hospitality.greeting,
      listening: score.hospitality.listening,
      courtesy: score.hospitality.courtesy,
      deadAir: score.hospitality.dead_air,
      warmEnding: score.hospitality.warm_ending,
      total: score.hospitality.total,
    });
    expect(card.detail.hardMetrics).toEqual({
      repTalkRatio: 0.44,
      questionCount: 6,
      deadAirSeconds: 12,
      interruptionCount: 0,
      durationSeconds: 540,
    });
    expect(card.detail.guarantees).toEqual(score.guarantees);
  });

  it('is deterministic -- same input, same output, no randomness/no Claude call', () => {
    const score = baseScore();
    expect(deriveCard(score)).toEqual(deriveCard(score));
  });
});
