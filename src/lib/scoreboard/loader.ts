// I/O for the scoreboard's call_scores read (0008, a sibling migration).
// Thin — the actual math lives in stats.ts and is unit-tested there; this
// file only fetches + reshapes rows, same split as
// src/lib/analytics/stats.ts's loadStatsInputs.
//
// The select() below deliberately never lists `fix` or any per-dimension
// `notes` column — defense in depth on top of CallScoreRow's own narrow
// shape (rule 3: the board never shows fixes or rough moments).

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '../supabase';
import type { CallScoreRow } from './stats';

type RawDimScore = { score: number; max: number; notes?: string };
type RawCallScoreRow = {
  rep_email: string;
  overall: number;
  experience_score: number;
  sales: { opening: RawDimScore; discovery: RawDimScore; value: RawDimScore; objections: RawDimScore; close: RawDimScore };
  hospitality: { greeting: RawDimScore; listening: RawDimScore; courtesy: RawDimScore; dead_air: RawDimScore; warm_ending: RawDimScore };
  win: string;
  called_at: string;
};

function stripDim(d: RawDimScore): { score: number; max: number } {
  return { score: d.score, max: d.max };
}

export function mapCallScoreRow(row: RawCallScoreRow): CallScoreRow {
  return {
    repEmail: row.rep_email,
    overall: row.overall,
    experienceScore: row.experience_score,
    sales: {
      opening: stripDim(row.sales.opening),
      discovery: stripDim(row.sales.discovery),
      value: stripDim(row.sales.value),
      objections: stripDim(row.sales.objections),
      close: stripDim(row.sales.close),
    },
    hospitality: {
      greeting: stripDim(row.hospitality.greeting),
      listening: stripDim(row.hospitality.listening),
      courtesy: stripDim(row.hospitality.courtesy),
      deadAir: stripDim(row.hospitality.dead_air),
      warmEnding: stripDim(row.hospitality.warm_ending),
    },
    win: row.win,
    calledAt: row.called_at,
  };
}

export type LoadCallScoresResult = { ok: true; rows: CallScoreRow[] } | { ok: false; missingTable: boolean };

// `repEmail` scopes the query server-side for a private ('own' scope) read —
// a rep's data never leaves the DB for anyone else in that case, rather than
// relying on the UI to hide it after the fact.
export async function loadCallScores(supabase: SupabaseClient, params: { repEmail?: string } = {}): Promise<LoadCallScoresResult> {
  let query = supabase
    .from('call_scores')
    .select('rep_email, overall, experience_score, sales, hospitality, win, called_at')
    .eq('metric_scope', 'performance');
  if (params.repEmail) query = query.eq('rep_email', params.repEmail);
  const { data, error } = await query;
  if (error) {
    if (!isMissingTableError(error)) console.error('Load call_scores for scoreboard failed:', error);
    return { ok: false, missingTable: isMissingTableError(error) };
  }
  return { ok: true, rows: ((data ?? []) as RawCallScoreRow[]).map(mapCallScoreRow) };
}
