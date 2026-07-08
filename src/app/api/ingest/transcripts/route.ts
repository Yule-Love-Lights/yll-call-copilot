// POST /api/ingest/transcripts — bulk-uploads call transcripts (.txt, .csv,
// or a .zip of either) for one vertical, creates an ingest_jobs row, inserts
// every parsed transcript, then processes the first batch (see
// src/lib/transcripts/ingest.ts) of outcome-matching + Claude extraction in
// this request. The remaining transcripts are picked up by the caller
// looping POST /api/ingest/continue with the returned jobId until
// `remaining` is 0 (see the Transcripts panel on /verticals/[id]).
//
// `maxDuration` is set high because even one 25-transcript batch makes up
// to 25 sequential Claude calls (and up to twice that many GHL calls)
// before responding.

import { NextResponse } from 'next/server';
import AdmZip from 'adm-zip';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { isClaudeConfigured } from '@/lib/claude';
import { parseTranscriptFiles, type UploadedFile } from '@/lib/transcripts/parse';
import { selectNextBatch } from '@/lib/transcripts/ingest';
import { processTranscriptBatch } from '@/lib/transcripts/process';

export const maxDuration = 300;

async function filesFromFormData(formData: FormData): Promise<UploadedFile[]> {
  const uploaded: UploadedFile[] = [];

  for (const entry of formData.getAll('files')) {
    if (!(entry instanceof File)) continue;
    const lower = entry.name.toLowerCase();

    if (lower.endsWith('.zip')) {
      const buffer = Buffer.from(await entry.arrayBuffer());
      const zip = new AdmZip(buffer);
      for (const zipEntry of zip.getEntries()) {
        if (zipEntry.isDirectory) continue;
        const zipLower = zipEntry.entryName.toLowerCase();
        if (!zipLower.endsWith('.txt') && !zipLower.endsWith('.csv')) continue;
        uploaded.push({ name: zipEntry.entryName, text: zipEntry.getData().toString('utf8') });
      }
      continue;
    }

    if (lower.endsWith('.txt') || lower.endsWith('.csv')) {
      uploaded.push({ name: entry.name, text: await entry.text() });
    }
    // Anything else (unsupported extension) is silently skipped — the
    // upload UI already restricts the file picker to .txt/.csv/.zip.
  }

  return uploaded;
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, reason: 'Supabase not configured.' });
  }
  // Extraction (Claude) is not optional in this pipeline — only outcome
  // matching is. Gate the whole upload upfront (same pattern as
  // /api/verticals/[id]/generate) rather than accepting the upload and
  // burning the first batch marking every transcript permanently failed.
  if (!isClaudeConfigured()) {
    return NextResponse.json({ configured: true, reason: 'Claude not configured.' });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ configured: true, error: 'Invalid form data.' }, { status: 400 });
  }

  const verticalId = String(formData.get('vertical_id') ?? '').trim();
  if (!verticalId) {
    return NextResponse.json({ configured: true, error: 'vertical_id is required.' }, { status: 400 });
  }
  const matchOutcomes = formData.get('matchOutcomes') !== 'false';

  const uploaded = await filesFromFormData(formData);
  const parsed = parseTranscriptFiles(uploaded);
  if (parsed.length === 0) {
    return NextResponse.json(
      { configured: true, error: 'No .txt or .csv transcripts found in the upload.' },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient()!;

  const { data: verticalData, error: verticalError } = await supabase
    .from('verticals')
    .select('id, name')
    .eq('id', verticalId)
    .maybeSingle();
  if (verticalError) {
    console.error('Load vertical for ingest failed:', verticalError);
    return NextResponse.json({ configured: true, error: 'Could not load vertical.' }, { status: 500 });
  }
  if (!verticalData) {
    return NextResponse.json({ configured: true, error: 'Vertical not found.' }, { status: 404 });
  }
  const verticalName = (verticalData as { name: string }).name;

  const { data: jobData, error: jobError } = await supabase
    .from('ingest_jobs')
    .insert({
      kind: 'transcripts',
      total: parsed.length,
      detail: { vertical_id: verticalId, match_outcomes: matchOutcomes },
    })
    .select('id')
    .single();
  if (jobError) {
    if (isMissingTableError(jobError)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0003 first.' });
    }
    console.error('Create ingest job failed:', jobError);
    return NextResponse.json({ configured: true, error: 'Could not create the ingest job.' }, { status: 500 });
  }
  const jobId = (jobData as { id: string }).id;

  const { data: transcriptRows, error: insertError } = await supabase
    .from('transcripts')
    .insert(
      parsed.map(t => ({
        vertical_id: verticalId,
        source_file: t.source_file,
        customer_name: t.customer_name,
        customer_phone: t.customer_phone,
        called_at: t.called_at,
        raw_text: t.raw_text,
      })),
    )
    .select('id');
  if (insertError) {
    await supabase
      .from('ingest_jobs')
      .update({ status: 'failed', finished_at: new Date().toISOString() })
      .eq('id', jobId);
    console.error('Insert transcripts failed:', insertError);
    return NextResponse.json({ configured: true, error: 'Could not store the transcripts.' }, { status: 500 });
  }

  const transcriptIds = (transcriptRows as { id: string }[]).map(r => r.id);

  // Persist the full id list before processing starts, so a stalled or
  // crashed request can still be resumed from /api/ingest/continue.
  // attempted_ids (not "has a learnings row") is what marks a transcript as
  // done-with-this-job — a transcript whose extraction fails never gets a
  // learnings row, and tracking progress by that row's existence would
  // retry a permanently-failing transcript forever instead of counting it
  // once into `failed` and moving on.
  await supabase
    .from('ingest_jobs')
    .update({
      detail: { vertical_id: verticalId, match_outcomes: matchOutcomes, transcript_ids: transcriptIds, attempted_ids: [] },
    })
    .eq('id', jobId);

  const plan = selectNextBatch(transcriptIds, new Set());
  const result = await processTranscriptBatch({
    supabase,
    transcriptIds: plan.batch,
    verticalId,
    verticalName,
    matchOutcomes,
  });

  const status = plan.jobDone ? 'done' : 'running';
  await supabase
    .from('ingest_jobs')
    .update({
      done: result.done,
      failed: result.failed,
      status,
      finished_at: plan.jobDone ? new Date().toISOString() : null,
      detail: {
        vertical_id: verticalId,
        match_outcomes: matchOutcomes,
        transcript_ids: transcriptIds,
        attempted_ids: plan.batch,
      },
    })
    .eq('id', jobId);

  return NextResponse.json({
    configured: true,
    jobId,
    total: parsed.length,
    done: result.done,
    failed: result.failed,
    status,
    remaining: plan.remainingAfterBatch,
  });
}
