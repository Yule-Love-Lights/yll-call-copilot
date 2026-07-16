// Supabase I/O for the weekly digest: loads call_scores rows for a date
// range (see migration 0008 for the exact column shape) and maps them to
// this module's CallScoreRow, plus the pending playbook_proposals created in
// a window, joined to their vertical's name for display. Kept separate from
// stats.ts so the aggregation stays a pure, fixture-testable function --
// same loader/aggregator split as src/lib/analytics/stats.ts
// (loadStatsInputs vs computeStats).

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '../supabase';
import { dateRangeToTimestamps } from '../analytics/stats';
import type { CallScoreRow, GuaranteeKey, GuaranteeEntry, HospitalityDim, SalesDim, ScoreMaxNote } from './stats';

export type LoadCallScoresResult = { ok: true; rows: CallScoreRow[] } | { ok: false; missingTable: boolean };

// The scorer's real jsonb shapes (snake_case columns) for the fix/emotional
// sub-objects -- distinct from stats.ts's FixMoment/EmotionalScore, which
// are the camelCase shapes the rest of the digest reads. Was previously
// passed straight through unmapped, which rendered "NaN:NaN" and a blank
// quote/better-line in the roughest-moment card (fixtures were camelCase,
// so the bug never showed up in tests).
type FixMomentDbRow = {
  moment: string;
  timestamp_seconds: number;
  transcript_quote: string;
  better_line: string;
};
type EmotionalScoreDbRow = {
  state: string | null;
  named_back: boolean | null;
  matched_track: boolean | null;
  grade: number | null;
  notes?: string | null;
};

type CallScoreDbRow = {
  id: string;
  rep_email: string;
  overall: number;
  experience_score: number;
  win: string | null;
  fix: FixMomentDbRow | null;
  emotional: EmotionalScoreDbRow | null;
  sales: (Partial<Record<SalesDim, ScoreMaxNote>> & { total?: number }) | null;
  hospitality: (Partial<Record<HospitalityDim, ScoreMaxNote>> & { total?: number }) | null;
  guarantees: Partial<Record<GuaranteeKey, GuaranteeEntry>> | null;
};

// Exported for direct unit coverage of the snake_case -> camelCase mapping
// (see loadCallScores.test.ts); loadCallScoreRows() below is the only real
// caller.
export function mapRow(r: CallScoreDbRow): CallScoreRow {
  return {
    id: r.id,
    repEmail: r.rep_email,
    overall: r.overall,
    experienceScore: r.experience_score,
    win: r.win,
    fix: r.fix
      ? { moment: r.fix.moment, timestampSeconds: r.fix.timestamp_seconds, transcriptQuote: r.fix.transcript_quote, betterLine: r.fix.better_line }
      : null,
    emotional: r.emotional
      ? { state: r.emotional.state, namedBack: r.emotional.named_back, matchedTrack: r.emotional.matched_track, grade: r.emotional.grade, notes: r.emotional.notes ?? null }
      : null,
    sales: r.sales,
    hospitality: r.hospitality,
    guarantees: r.guarantees,
  };
}

// Loads every call_scores row with called_at inside [from, to] (inclusive
// whole days, same date-range convention as src/lib/analytics/stats.ts).
// Team-wide -- the digest is not scoped to one vertical, unlike the brain
// review -- so no vertical filter here.
export async function loadCallScoreRows(supabase: SupabaseClient, from: string, to: string): Promise<LoadCallScoresResult> {
  const { startIso, endIso } = dateRangeToTimestamps(from, to);
  const { data, error } = await supabase
    .from('call_scores')
    .select('id, rep_email, overall, experience_score, win, fix, emotional, sales, hospitality, guarantees')
    .gte('called_at', startIso)
    .lte('called_at', endIso);
  if (error) {
    if (!isMissingTableError(error)) console.error('Load call_scores for digest failed:', error);
    return { ok: false, missingTable: isMissingTableError(error) };
  }
  return { ok: true, rows: ((data ?? []) as CallScoreDbRow[]).map(mapRow) };
}

export type ProposalForDigest = {
  id: string;
  verticalId: string;
  verticalName: string;
  section: string;
  kind: string;
  currentValue: unknown;
  proposedValue: unknown;
  evidence: string;
  createdAt: string;
};

export type LoadDigestProposalsResult = { ok: true; proposals: ProposalForDigest[] } | { ok: false; missingTable: boolean };

// Pending playbook_proposals created inside the digest window, across every
// vertical -- these are the brain review's output (see
// src/lib/analytics/runBrainReview.ts), the digest doesn't generate its own.
// The join to verticals for a display name is done in JS, same style
// src/lib/analytics/stats.ts already uses for its lead/call join, rather
// than a PostgREST embedded filter.
export async function loadDigestProposals(supabase: SupabaseClient, from: string, to: string): Promise<LoadDigestProposalsResult> {
  const { startIso, endIso } = dateRangeToTimestamps(from, to);
  const { data: proposalRows, error: proposalsError } = await supabase
    .from('playbook_proposals')
    .select('id, vertical_id, section, kind, current_value, proposed_value, evidence, created_at')
    .eq('status', 'pending')
    .gte('created_at', startIso)
    .lte('created_at', endIso)
    .order('created_at', { ascending: false });
  if (proposalsError) {
    if (!isMissingTableError(proposalsError)) console.error('Load playbook_proposals for digest failed:', proposalsError);
    return { ok: false, missingTable: isMissingTableError(proposalsError) };
  }
  const rows = (proposalRows ?? []) as {
    id: string;
    vertical_id: string;
    section: string;
    kind: string;
    current_value: unknown;
    proposed_value: unknown;
    evidence: string;
    created_at: string;
  }[];
  if (rows.length === 0) return { ok: true, proposals: [] };

  const verticalIds = [...new Set(rows.map(r => r.vertical_id))];
  const { data: verticalRows, error: verticalsError } = await supabase.from('verticals').select('id, name').in('id', verticalIds);
  if (verticalsError) {
    console.error('Load verticals for digest proposals failed:', verticalsError);
    return { ok: false, missingTable: false };
  }
  const nameById = new Map(((verticalRows ?? []) as { id: string; name: string }[]).map(v => [v.id, v.name]));

  return {
    ok: true,
    proposals: rows.map(r => ({
      id: r.id,
      verticalId: r.vertical_id,
      verticalName: nameById.get(r.vertical_id) ?? '(unknown vertical)',
      section: r.section,
      kind: r.kind,
      currentValue: r.current_value,
      proposedValue: r.proposed_value,
      evidence: r.evidence,
      createdAt: r.created_at,
    })),
  };
}
