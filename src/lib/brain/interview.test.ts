// Coverage for the curated interview question bank: shape (every question
// has a non-empty id/question, a valid lens), coverage (at least one
// question per lens, per the "every lens gets touched" brief), and no
// duplicate ids (the UI keys steps off this).

import { describe, it, expect } from 'vitest';
import { INTERVIEW_QUESTIONS } from './interview';
import { INSIGHT_LENSES } from './types';

describe('INTERVIEW_QUESTIONS', () => {
  it('has between 6 and 8 questions', () => {
    expect(INTERVIEW_QUESTIONS.length).toBeGreaterThanOrEqual(6);
    expect(INTERVIEW_QUESTIONS.length).toBeLessThanOrEqual(8);
  });

  it('every question has a non-empty id, theme, and question text', () => {
    for (const q of INTERVIEW_QUESTIONS) {
      expect(q.id.trim().length).toBeGreaterThan(0);
      expect(q.theme.trim().length).toBeGreaterThan(0);
      expect(q.question.trim().length).toBeGreaterThan(0);
    }
  });

  it('every question is tagged with a valid lens', () => {
    for (const q of INTERVIEW_QUESTIONS) {
      expect(INSIGHT_LENSES).toContain(q.lens);
    }
  });

  it('has no duplicate ids', () => {
    const ids = INTERVIEW_QUESTIONS.map(q => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers every lens at least once', () => {
    const lensesCovered = new Set(INTERVIEW_QUESTIONS.map(q => q.lens));
    for (const lens of INSIGHT_LENSES) {
      expect(lensesCovered.has(lens)).toBe(true);
    }
  });

  it('includes the reel-quoted questions verbatim (market, customers, best calls, objections, differentiation)', () => {
    const questionText = INTERVIEW_QUESTIONS.map(q => q.question);
    expect(questionText).toContain('What is happening in your market right now that changes how you sell?');
    expect(questionText).toContain('Describe your best-fit customer and the moment they decide to buy.');
    expect(questionText).toContain('Walk through a call that went perfectly. What did the rep do?');
    expect(questionText).toContain('What are the three objections you hear most, and the line that works on each?');
    expect(questionText).toContain('Why do customers pick you over the cheaper option?');
  });
});
