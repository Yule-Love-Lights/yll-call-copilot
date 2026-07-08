// POST /api/ingest/continue — body {jobId}. Processes the next batch of up
// to 25 not-yet-extracted transcripts for that job (see
// src/lib/transcripts/ingest.ts), updates the job's counters, and marks it
// done once none remain. The UI loops this until the job reports done — see
// the Transcripts panel on /verticals/[id]. No queue infra: this survives
// Next's per-request execution limits by chunking instead.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { isClaudeConfigured } from '@/lib/claude';
import { selectNextBatch } from '@/lib/transcripts/ingest';
import { processTranscriptBatch } from '@/lib/transcripts/process';
import type { IngestJobRow } from '@/lib/transcripts/types';

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, reason: 'Supabase not configured.' });
  }
  // See the matching gate in /api/ingest/transcripts — don't burn a batch
  // marking transcripts permanently failed if Claude isn't configured.
  if (!isClaudeConfigured()) {
    return NextResponse.json({ configured: true, reason: 'Claude not configured.' });
  }

  const body = await request.json().catch(() => null);
  const jobId = typeof body?.jobId === 'string' ? body.jobId : '';
  if (!jobId) {
    return NextResponse.json({ configured: true, error: 'jobId is required.' }, { status: 400 });
  }

  const supabase = getSupabaseServerClient()!;

  const { data: jobData, error: jobError } = await supabase
    .from('ingest_jobs')
    .select('id, total, done, failed, status, detail')
    .eq('id', jobId)
    .maybeSingle();
  if (jobError) {
    if (isMissingTableError(jobError)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0003 first.' });
    }
    console.error('Load ingest job failed:', jobError);
    return NextResponse.json({ configured: true, error: 'Could not load the ingest job.' }, { status: 500 });
  }
  if (!jobData) {
    return NextResponse.json({ configured: true, error: 'Ingest job not found.' }, { status: 404 });
  }
  const job = jobData as Pick<IngestJobRow, 'id' | 'total' | 'done' | 'failed' | 'status' | 'detail'>;

  if (job.status !== 'running') {
    return NextResponse.json({
      configured: true,
      jobId: job.id,
      total: job.total,
      done: job.done,
      failed: job.failed,
      status: job.status,
      remaining: 0,
    });
  }

  const detail = (job.detail ?? {}) as {
    vertical_id?: string;
    match_outcomes?: boolean;
    transcript_ids?: string[];
    attempted_ids?: string[];
  };
  const verticalId = detail.vertical_id ?? '';
  const transcriptIds = detail.transcript_ids ?? [];
  const matchOutcomes = detail.match_outcomes ?? true;
  const attemptedIds = detail.attempted_ids ?? [];

  if (!verticalId || transcriptIds.length === 0) {
    return NextResponse.json(
      { configured: true, error: 'Ingest job is missing its transcript list.' },
      { status: 500 },
    );
  }

  const { data: verticalData } = await supabase.from('verticals').select('name').eq('id', verticalId).maybeSingle();
  const verticalName = (verticalData as { name: string } | null)?.name ?? '';

  // Progress is tracked by attempted_ids, not "has a learnings row" — a
  // transcript whose extraction fails never gets one, and tracking by that
  // row's existence would retry a permanently-failing transcript forever
  // instead of counting it once into `failed` and moving on.
  const plan = selectNextBatch(transcriptIds, new Set(attemptedIds));
  const result = await processTranscriptBatch({
    supabase,
    transcriptIds: plan.batch,
    verticalId,
    verticalName,
    matchOutcomes,
  });

  const done = job.done + result.done;
  const failed = job.failed + result.failed;
  const status = plan.jobDone ? 'done' : 'running';

  await supabase
    .from('ingest_jobs')
    .update({
      done,
      failed,
      status,
      finished_at: plan.jobDone ? new Date().toISOString() : null,
      detail: {
        vertical_id: verticalId,
        match_outcomes: matchOutcomes,
        transcript_ids: transcriptIds,
        attempted_ids: [...attemptedIds, ...plan.batch],
      },
    })
    .eq('id', jobId);

  return NextResponse.json({
    configured: true,
    jobId,
    total: job.total,
    done,
    failed,
    status,
    remaining: plan.remainingAfterBatch,
  });
}
