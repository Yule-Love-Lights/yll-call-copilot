// Shape of a generated/edited call playbook. Defined once here and
// reused by generation (generate.ts), the hand-rolled validator
// (validate.ts), the API routes, and the UI — never redefined.

export type Playbook = {
  icp: string; // ideal customer profile, plain English
  angles: string[]; // call angles / reasons-to-call
  openers: { label: string; script: string }[]; // "Inbound follow-up", "Past customer", "Quote follow-up", "Neighbor install / referral", "Cold"
  objections: { objection: string; response: string }[];
  avoid: string[]; // things never to say
  voicemail: string; // 20-second voicemail script
};

export type PlaybookSource = 'generated' | 'edited';

// Row shapes for the `verticals` and `playbook_versions` tables (see
// supabase/migrations/0002_playbooks.sql). Only the columns the app reads and
// writes — not a full generated Supabase schema.
export type VerticalRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  knowledge_notes: string;
  active_version: number;
  season_window: string | null;
  created_at: string;
};

export type PlaybookVersionRow = {
  id: string;
  vertical_id: string;
  version: number;
  content: Playbook;
  source: PlaybookSource;
  created_at: string;
};
