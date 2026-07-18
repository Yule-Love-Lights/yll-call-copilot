// The curated question bank for "Interview yourself" (Wave 1 PR B, Seed the
// Brain): a fixed list the UI walks the operator through one at a time, no
// per-turn Claude call for asking (only the final distillation, in
// distillInterview.ts, calls Claude). Covers the reel's five themes --
// market, best-fit customers, best calls, objections, differentiation --
// plus two rounded-out questions so every lens (market/leads/coaching/
// general) gets at least one question. Each question is pre-tagged with
// the lens its answer will likely belong to; distillInterview.ts's system
// prompt keeps that lens unless the actual answer clearly says otherwise.

import type { InsightLens } from './types';

export type InterviewQuestion = {
  id: string;
  lens: InsightLens;
  theme: string;
  question: string;
};

export const INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  {
    id: 'market_pulse',
    lens: 'market',
    theme: 'Your market',
    question: 'What is happening in your market right now that changes how you sell?',
  },
  {
    id: 'best_fit_customer',
    lens: 'leads',
    theme: 'Your best-fit customer',
    question: 'Describe your best-fit customer and the moment they decide to buy.',
  },
  {
    id: 'red_flag_customer',
    lens: 'leads',
    theme: 'Who is not a fit',
    question: 'What is the clearest sign, early in a call, that someone is not your best-fit customer?',
  },
  {
    id: 'perfect_call',
    lens: 'coaching',
    theme: 'Your best calls',
    question: 'Walk through a call that went perfectly. What did the rep do?',
  },
  {
    id: 'top_objections',
    lens: 'coaching',
    theme: 'Objections',
    question: 'What are the three objections you hear most, and the line that works on each?',
  },
  {
    id: 'why_not_cheaper',
    lens: 'market',
    theme: 'Differentiation',
    question: 'Why do customers pick you over the cheaper option?',
  },
  {
    id: 'unwritten_rule',
    lens: 'general',
    theme: 'The unwritten rule',
    question: "What is one thing you wish every rep understood about this business that nobody has told them?",
  },
];
