// Shared shapes for practice (Wave 2, PR 1): a rep rehearses a call against
// an AI-played homeowner and gets scored on the exact same rubric as a real
// call. Mirrors supabase/migrations/0016_practice.sql -- only the columns
// the app reads/writes, same convention as playbook/types.ts and
// feedback/types.ts.

import type { CallScoreContent } from '../scoring/types';

// The four states a rep can pick to practice diagnosing + matching -- same
// four the rubric's master instruction grades on (src/lib/scoring/rubric.ts's
// SEEDED_RUBRIC.master), minus 'unclear' (a real call can land there; a
// practice scenario is always a deliberate pick).
export type PracticeEmotionalState = 'excited' | 'busy' | 'guarded' | 'status';

export type PracticeTurnSpeaker = 'rep' | 'customer';

export type PracticeTurn = {
  speaker: PracticeTurnSpeaker;
  text: string;
  at: string; // ISO timestamp
};

export type PracticeStatus = 'active' | 'ended';

export type PracticeSessionRow = {
  id: string;
  rep_email: string | null;
  vertical_slug: string | null;
  emotional_state: PracticeEmotionalState;
  objective: string | null;
  turns: PracticeTurn[];
  status: PracticeStatus;
  score: CallScoreContent | null;
  created_at: string;
  ended_at: string | null;
};
