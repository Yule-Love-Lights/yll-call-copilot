// Runs one weekly digest: computes this week's period (a rolling 7-day
// window ending "now", reusing periodFromDays from src/lib/analytics/
// stats.ts -- the same weekly-period convention the brain review already
// established, rather than inventing calendar Mon-Sun boundaries), loads
// this week's + last week's call_scores (migration 0008) plus this week's
// pending playbook proposals, computes stats, makes ONE Claude call for an
// honest week (src/lib/digest/generate.ts), and stores the result as a
// weekly_digests row. Shared by GET /api/cron/weekly-digest (skips a week
// that already has a digest -- idempotent via the unique(period_start,
// period_end) constraint) and POST /api/digest/generate (replaces the
// current week's digest on demand), so there is one place this
// orchestration lives, same "no internal HTTP round-trip" philosophy as
// runBrainReview.ts.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '../supabase';
import { periodFromDays } from '../analytics/stats';
import { computeDigestStats, type DigestStats } from './stats';
import { loadCallScoreRows, loadDigestProposals, type ProposalForDigest } from './loadCallScores';
import { generateWeeklyDigestNarrative, type RolePlay } from './generate';
import type { BestCall, RoughestMoment } from './stats';

export type DigestContent = {
  stats: DigestStats;
  narrative: string;
  trainingFocus: string;
  bestCall: BestCall | null;
  roughestMoment: RoughestMoment | null;
  proposals: ProposalForDigest[];
  rolePlay: RolePlay | null;
};

export type SavedDigest = { id: string; periodStart: string; periodEnd: string; content: DigestContent; createdAt: string };

export type RunDigestFailureKind = 'missing_table' | 'load_error' | 'generation_failed' | 'store_failed';
export type RunDigestResult =
  | { ok: true; digest: SavedDigest; alreadyExisted: boolean }
  | { ok: false; kind: RunDigestFailureKind; reason: string };

// 'skip-if-exists' is the cron route's idempotent no-op behavior; 'replace'
// is the manual "Generate now" button's delete-and-reinsert behavior.
export type RunDigestMode = 'skip-if-exists' | 'replace';

function mapDigestRow(row: { id: string; period_start: string; period_end: string; content: DigestContent; created_at: string }): SavedDigest {
  return { id: row.id, periodStart: row.period_start, periodEnd: row.period_end, content: row.content, createdAt: row.created_at };
}

export async function runWeeklyDigest(
  supabase: SupabaseClient,
  opts: { periodDays?: number; mode: RunDigestMode; now?: Date } = { mode: 'skip-if-exists' },
): Promise<RunDigestResult> {
  const now = opts.now ?? new Date();
  const { periodStart, periodEnd } = periodFromDays(opts.periodDays ?? 7, now);

  const { data: existingRow, error: existingError } = await supabase
    .from('weekly_digests')
    .select('id, period_start, period_end, content, created_at')
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .maybeSingle();
  if (existingError) {
    if (isMissingTableError(existingError)) {
      return { ok: false, kind: 'missing_table', reason: 'Run migrations 0008 and 0010 first.' };
    }
    console.error('Load existing weekly digest failed:', existingError);
    return { ok: false, kind: 'load_error', reason: 'Could not check for an existing digest.' };
  }

  if (existingRow) {
    if (opts.mode === 'skip-if-exists') {
      return { ok: true, digest: mapDigestRow(existingRow as { id: string; period_start: string; period_end: string; content: DigestContent; created_at: string }), alreadyExisted: true };
    }
    const { error: deleteError } = await supabase.from('weekly_digests').delete().eq('id', (existingRow as { id: string }).id);
    if (deleteError) {
      console.error('Delete existing weekly digest failed:', deleteError);
      return { ok: false, kind: 'store_failed', reason: 'Could not replace the existing digest.' };
    }
  }

  // Last week: the 7 (or periodDays) days immediately before periodStart --
  // computed by re-running periodFromDays with "now" moved back to the
  // instant before periodStart, so the two windows never overlap.
  const priorNow = new Date(new Date(`${periodStart}T00:00:00.000Z`).getTime() - 1);
  const lastPeriod = periodFromDays(opts.periodDays ?? 7, priorNow);

  const thisWeekResult = await loadCallScoreRows(supabase, periodStart, periodEnd);
  if (!thisWeekResult.ok) {
    return thisWeekResult.missingTable
      ? { ok: false, kind: 'missing_table', reason: 'Run migrations 0008 and 0010 first.' }
      : { ok: false, kind: 'load_error', reason: 'Could not load this week\'s call scores.' };
  }
  const lastWeekResult = await loadCallScoreRows(supabase, lastPeriod.periodStart, lastPeriod.periodEnd);
  if (!lastWeekResult.ok) {
    return lastWeekResult.missingTable
      ? { ok: false, kind: 'missing_table', reason: 'Run migrations 0008 and 0010 first.' }
      : { ok: false, kind: 'load_error', reason: 'Could not load last week\'s call scores.' };
  }

  const proposalsResult = await loadDigestProposals(supabase, periodStart, periodEnd);
  if (!proposalsResult.ok) {
    return proposalsResult.missingTable
      ? { ok: false, kind: 'missing_table', reason: 'Run migration 0003 first.' }
      : { ok: false, kind: 'load_error', reason: 'Could not load this week\'s playbook proposals.' };
  }

  const stats = computeDigestStats({ periodStart, periodEnd, thisWeek: thisWeekResult.rows, lastWeek: lastWeekResult.rows });

  let narrative: string;
  let trainingFocus: string;
  let rolePlay: RolePlay | null;
  if (stats.team.calls === 0) {
    // No scored calls this week -- an honest, non-fabricated digest rather
    // than spending a Claude call synthesizing a narrative from nothing.
    narrative = 'No calls were scored this week. Nothing to review yet -- check back next Friday.';
    trainingFocus = 'No training focus this week; no calls were scored.';
    rolePlay = null;
  } else {
    try {
      const generated = await generateWeeklyDigestNarrative({ stats, proposals: proposalsResult.proposals });
      narrative = generated.narrative;
      trainingFocus = generated.trainingFocus;
      rolePlay = generated.rolePlay;
    } catch (err) {
      console.error('Generate weekly digest failed:', err);
      return { ok: false, kind: 'generation_failed', reason: 'Digest generation failed.' };
    }
  }

  const content: DigestContent = {
    stats,
    narrative,
    trainingFocus,
    bestCall: stats.bestCall,
    roughestMoment: stats.roughestMoment,
    proposals: proposalsResult.proposals,
    rolePlay,
  };

  const { data: insertedRow, error: insertError } = await supabase
    .from('weekly_digests')
    .insert({ period_start: periodStart, period_end: periodEnd, content })
    .select('id, period_start, period_end, content, created_at')
    .single();
  if (insertError) {
    if (isMissingTableError(insertError)) {
      return { ok: false, kind: 'missing_table', reason: 'Run migration 0010 first.' };
    }
    console.error('Insert weekly digest failed:', insertError);
    return { ok: false, kind: 'store_failed', reason: 'Could not store the digest.' };
  }

  return {
    ok: true,
    digest: mapDigestRow(insertedRow as { id: string; period_start: string; period_end: string; content: DigestContent; created_at: string }),
    alreadyExisted: false,
  };
}
