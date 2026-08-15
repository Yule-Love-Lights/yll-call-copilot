// Shared shapes for Phase 1.5: knowledge documents, ingested transcripts,
// the structured learnings Claude extracts per call, and the playbook-edit
// proposals distilled from those learnings. Row shapes mirror
// supabase/migrations/0003_knowledge.sql — same convention as
// playbook/types.ts (only the columns the app reads/writes, not a full
// generated schema).

export type DocumentKind = 'upload' | 'note';

export type DocumentRow = {
  id: string;
  vertical_id: string;
  title: string;
  kind: DocumentKind;
  content: string;
  created_at: string;
};

export type TranscriptOutcome = 'booked' | 'not_booked' | 'unknown';
export type TranscriptMetricScope = 'performance' | 'training';

export type TranscriptRow = {
  id: string;
  vertical_id: string | null;
  source_file: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  called_at: string | null;
  raw_text: string;
  outcome: TranscriptOutcome;
  outcome_source: string | null;
  ghl_contact_id: string | null;
  metric_scope: TranscriptMetricScope;
  created_at: string;
};

// The structured shape Claude extracts per call (src/lib/transcripts/
// extract.ts) and the shape stored in the `learnings` table's jsonb/text
// columns.
export type Objection = {
  objection: string;
  customer_words: string;
  rep_response: string;
  worked: boolean | null;
};

export type Learnings = {
  objections: Objection[];
  customer_language: string[];
  what_worked: string[];
  what_failed: string[];
  price_talk: string[];
  questions: string[];
  summary: string;
};

export type LearningsRow = {
  id: string;
  transcript_id: string;
  vertical_id: string | null;
  objections: Objection[] | null;
  customer_language: string[] | null;
  what_worked: string[] | null;
  what_failed: string[] | null;
  price_talk: string[] | null;
  questions: string[] | null;
  summary: string | null;
  extracted_at: string;
};

export type ProposalSection = 'icp' | 'angles' | 'openers' | 'objections' | 'avoid' | 'voicemail';
export type ProposalKind = 'add' | 'change' | 'remove';
export type ProposalStatus = 'pending' | 'approved' | 'rejected';

export type PlaybookProposalRow = {
  id: string;
  vertical_id: string;
  section: ProposalSection;
  kind: ProposalKind;
  current_value: unknown;
  proposed_value: unknown;
  evidence: string;
  status: ProposalStatus;
  created_at: string;
  decided_at: string | null;
};

export type IngestJobKind = 'transcripts';
export type IngestJobStatus = 'running' | 'done' | 'failed';

export type IngestJobRow = {
  id: string;
  kind: IngestJobKind;
  total: number;
  done: number;
  failed: number;
  status: IngestJobStatus;
  detail: Record<string, unknown> | null;
  created_at: string;
  finished_at: string | null;
};
