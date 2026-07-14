// Shared "score the next batch of unscored substantive calls" step, used by
// both GET /api/cron/score-calls and POST /api/scores/continue -- same
// shared-batch-processor shape as transcripts/process.ts's
// processTranscriptBatch, which both ingest routes call into.
//
// Stateless and newest-first: each call re-reads the most recent
// CANDIDATE_WINDOW transcripts, drops the ones already in call_scores, drops
// non-substantive ones, and scores up to `limit` of what's left. No job
// table -- unlike the ingest flow's ingest_jobs, a batch of unscored calls
// keeps shrinking on its own as the cron runs daily, so there is nothing to
// track between invocations.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '../supabase';
import { isClaudeConfigured } from '../claude';
import type { Playbook, PlaybookVersionRow, VerticalRow } from '../playbook/types';
import type { Utterance } from './metrics';
import { computeHardMetrics } from './metrics';
import { isSubstantiveTranscript } from './substantive';
import { getActiveRubric } from './rubric';
import { scoreCall } from './score';
import { DEFAULT_OFFER_ELEMENTS, type OfferElement } from './types';

// Bounds the per-invocation read to a recent window rather than the whole
// transcripts table -- generous relative to the per-run scoring limit (8),
// so several consecutive runs clear a same-day backlog without an
// unbounded "not in (...)" list. Historical bulk-ingested transcripts
// outside this window are a separate backfill concern, not this cron's job.
const CANDIDATE_WINDOW = 200;

export type ScoreCandidate = {
  id: string;
  raw_text: string;
  utterances: Utterance[] | null;
};

// Pure selection: drop already-scored and non-substantive candidates, then
// cap at `limit`. The caller is responsible for handing candidates in the
// order it wants preserved (newest-first). Generic over T so scoreNextBatch
// can pass its fuller transcript row type through without losing the extra
// fields (vertical_id, called_at) it needs after selection.
export function selectScoreCandidates<T extends ScoreCandidate>(
  candidates: T[],
  alreadyScoredIds: ReadonlySet<string>,
  limit: number,
): T[] {
  return candidates
    .filter(c => !alreadyScoredIds.has(c.id))
    .filter(c => isSubstantiveTranscript({ raw_text: c.raw_text, utterances: c.utterances }))
    .slice(0, limit);
}

// Resolves the offer elements to grade guarantees against: reads the latest
// offer_versions row (content = { elements: [...] }), which ships in
// sibling migration 0014. Until that migration lands (or on any read
// failure/empty table), falls back to DEFAULT_OFFER_ELEMENTS so scoring
// never blocks on that table's existence.
export async function getOfferElements(supabase: SupabaseClient): Promise<OfferElement[]> {
  const { data, error } = await supabase
    .from('offer_versions')
    .select('content')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (!isMissingTableError(error)) {
      console.error('Load offer_versions failed, falling back to DEFAULT_OFFER_ELEMENTS:', error);
    }
    return DEFAULT_OFFER_ELEMENTS;
  }
  const elements = (data as { content?: { elements?: OfferElement[] } } | null)?.content?.elements;
  return elements && elements.length > 0 ? elements : DEFAULT_OFFER_ELEMENTS;
}

export type ScoreBatchResult = { scored: number; skipped: number; failed: number };

export async function scoreNextBatch(supabase: SupabaseClient, limit: number): Promise<ScoreBatchResult> {
  if (!isClaudeConfigured()) return { scored: 0, skipped: 0, failed: 0 };

  const { data: transcriptRows, error: transcriptsError } = await supabase
    .from('transcripts')
    .select('id, raw_text, vertical_id, called_at, utterances')
    .order('called_at', { ascending: false, nullsFirst: false })
    .limit(CANDIDATE_WINDOW);
  if (transcriptsError) {
    if (isMissingTableError(transcriptsError)) return { scored: 0, skipped: 0, failed: 0 };
    console.error('Load candidate transcripts for scoring failed:', transcriptsError);
    return { scored: 0, skipped: 0, failed: 0 };
  }
  const candidates = (transcriptRows ?? []) as {
    id: string;
    raw_text: string;
    vertical_id: string | null;
    called_at: string | null;
    utterances: Utterance[] | null;
  }[];
  if (candidates.length === 0) return { scored: 0, skipped: 0, failed: 0 };

  const candidateIds = candidates.map(c => c.id);
  const { data: scoredRows, error: scoredError } = await supabase
    .from('call_scores')
    .select('transcript_id')
    .in('transcript_id', candidateIds);
  if (scoredError && !isMissingTableError(scoredError)) {
    console.error('Load already-scored transcript ids failed:', scoredError);
    return { scored: 0, skipped: 0, failed: 0 };
  }
  const alreadyScoredIds = new Set((scoredRows ?? []).map(r => (r as { transcript_id: string }).transcript_id));

  const selected = selectScoreCandidates(candidates, alreadyScoredIds, limit);
  const skipped = candidates.length - alreadyScoredIds.size - selected.length;
  if (selected.length === 0) return { scored: 0, skipped: Math.max(0, skipped), failed: 0 };

  const rubricResult = await getActiveRubric(supabase);
  if (!rubricResult.ok) return { scored: 0, skipped: 0, failed: selected.length };
  const offerElements = await getOfferElements(supabase);

  const verticalCache = new Map<string, { name: string; slug: string | null; playbook: Playbook | null }>();
  async function loadVerticalContext(verticalId: string | null) {
    if (!verticalId) return { name: 'Unknown', slug: null as string | null, playbook: null as Playbook | null };
    const cached = verticalCache.get(verticalId);
    if (cached) return cached;

    const { data: verticalData } = await supabase
      .from('verticals')
      .select('name, slug, active_version')
      .eq('id', verticalId)
      .maybeSingle();
    const vertical = verticalData as Pick<VerticalRow, 'name' | 'slug' | 'active_version'> | null;

    let playbook: Playbook | null = null;
    if (vertical && vertical.active_version > 0) {
      const { data: versionData } = await supabase
        .from('playbook_versions')
        .select('content')
        .eq('vertical_id', verticalId)
        .eq('version', vertical.active_version)
        .maybeSingle();
      playbook = (versionData as Pick<PlaybookVersionRow, 'content'> | null)?.content ?? null;
    }

    const resolved = { name: vertical?.name ?? 'Unknown', slug: vertical?.slug ?? null, playbook };
    verticalCache.set(verticalId, resolved);
    return resolved;
  }

  let scored = 0;
  let failed = 0;

  for (const candidate of selected) {
    try {
      const utterancesAvailable = !!candidate.utterances && candidate.utterances.length > 0;
      const hardMetrics = utterancesAvailable
        ? computeHardMetrics(candidate.utterances as Utterance[])
        : null; // resolved to the model's own estimate once scoreCall returns

      const context = await loadVerticalContext(candidate.vertical_id);

      const { data: callRow } = await supabase
        .from('calls')
        .select('rep_email')
        .eq('transcript_id', candidate.id)
        .maybeSingle();
      const repEmail = (callRow as { rep_email: string | null } | null)?.rep_email ?? null;

      const content = await scoreCall({
        verticalName: context.name,
        rubric: rubricResult.content,
        playbook: context.playbook,
        offerElements,
        rawText: candidate.raw_text,
        // scoreCall only uses this as its final override when utterances
        // were available; when they weren't, assembleCallScore uses the
        // model's own hard_metrics_estimate instead, so a placeholder here
        // is never actually stored.
        hardMetrics: hardMetrics ?? {
          rep_talk_ratio: 0,
          question_count: 0,
          dead_air_seconds: 0,
          interruption_count: 0,
          duration_seconds: 0,
        },
        utterancesAvailable,
      });

      const { error: upsertError } = await supabase.from('call_scores').upsert(
        {
          transcript_id: candidate.id,
          rubric_version: rubricResult.version,
          rep_email: repEmail,
          vertical_slug: context.slug,
          called_at: candidate.called_at,
          emotional: content.emotional,
          sales: content.sales,
          hospitality: content.hospitality,
          hard_metrics: content.hard_metrics,
          experience: content.experience,
          experience_score: content.experience_score,
          guarantees: content.guarantees,
          overall: content.overall,
          win: content.win,
          fix: content.fix,
        },
        { onConflict: 'transcript_id' },
      );
      if (upsertError) throw upsertError;

      scored++;
    } catch (err) {
      console.error(`Failed to score transcript ${candidate.id}:`, err);
      failed++;
    }
  }

  return { scored, skipped: Math.max(0, skipped), failed };
}
