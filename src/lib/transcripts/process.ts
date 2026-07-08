// Shared per-batch processing used by both ingest routes (the initial
// upload and the /continue loop): for each transcript id, optionally match
// its outcome against GHL, then extract learnings with Claude, persisting
// as it goes. Sequential and rate-limit-safe — a bulk ingest can be
// thousands of transcripts, and GHL (up to twice) and Claude (once) are
// both called per transcript.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getStageNameMap, isHighLevelConfigured } from '../ghl/client';
import { isClaudeConfigured } from '../claude';
import { matchOutcome } from './outcomes';
import { extractLearnings } from './extract';
import { delay, GHL_RATE_LIMIT_GAP_MS } from './ingest';
import type { TranscriptRow } from './types';

export type ProcessBatchInput = {
  supabase: SupabaseClient;
  transcriptIds: string[];
  verticalId: string;
  verticalName: string;
  matchOutcomes: boolean;
};

export type ProcessBatchResult = { done: number; failed: number };

export async function processTranscriptBatch(input: ProcessBatchInput): Promise<ProcessBatchResult> {
  const { supabase, transcriptIds, verticalId, verticalName, matchOutcomes } = input;
  if (transcriptIds.length === 0) return { done: 0, failed: 0 };

  const matchingEnabled = matchOutcomes && isHighLevelConfigured();
  const stageNames = matchingEnabled
    ? await getStageNameMap().catch(err => {
        console.error('Failed to load GHL pipeline stages:', err);
        return new Map<string, string>();
      })
    : new Map<string, string>();

  let done = 0;
  let failed = 0;

  for (const transcriptId of transcriptIds) {
    try {
      const { data, error } = await supabase
        .from('transcripts')
        .select('id, raw_text, customer_name, customer_phone')
        .eq('id', transcriptId)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Transcript not found.');
      const transcript = data as Pick<TranscriptRow, 'id' | 'raw_text' | 'customer_name' | 'customer_phone'>;

      if (matchingEnabled) {
        const match = await matchOutcome(
          { customer_phone: transcript.customer_phone, customer_name: transcript.customer_name },
          stageNames,
        );
        // Checked, unlike the rest of this pipeline's writes: a swallowed
        // failure here left outcome stuck at its 'unknown' default forever
        // (attempted_ids marks this transcript handled either way, so
        // there's no retry path once this batch moves on) while still
        // counting the transcript as successfully processed, silently
        // skewing the booked/not_booked/unknown split computeInsights
        // reports. Thrown here (same as the learnings insert below) so it
        // counts into `failed` and gets logged via this loop's own catch,
        // instead of continuing on as if the match had actually stuck.
        const { error: outcomeUpdateError } = await supabase
          .from('transcripts')
          .update({
            outcome: match.outcome,
            outcome_source: match.outcome_source,
            ghl_contact_id: match.ghl_contact_id,
          })
          .eq('id', transcriptId);
        if (outcomeUpdateError) throw outcomeUpdateError;
        await delay(GHL_RATE_LIMIT_GAP_MS);
      }

      if (!isClaudeConfigured()) {
        throw new Error('Claude not configured.');
      }
      const learnings = await extractLearnings(transcript.raw_text, verticalName);
      // Upsert, not insert: a retried batch (a timeout/crash mid-batch
      // re-processes an already-succeeded transcript via /api/ingest/
      // continue's attempted_ids tracking) must not create a second row for
      // the same transcript — see the unique(transcript_id) constraint on
      // this table (0003_knowledge.sql).
      const { error: insertError } = await supabase.from('learnings').upsert(
        {
          transcript_id: transcriptId,
          vertical_id: verticalId,
          objections: learnings.objections,
          customer_language: learnings.customer_language,
          what_worked: learnings.what_worked,
          what_failed: learnings.what_failed,
          price_talk: learnings.price_talk,
          questions: learnings.questions,
          summary: learnings.summary,
        },
        { onConflict: 'transcript_id' },
      );
      if (insertError) throw insertError;

      done++;
    } catch (err) {
      console.error(`Failed to process transcript ${transcriptId}:`, err);
      failed++;
    }
  }

  return { done, failed };
}
