// GET /api/ingest/jobs/[id] — job status JSON, polled by the Transcripts
// panel on /verticals/[id] while an ingest job is running.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import type { IngestJobRow } from '@/lib/transcripts/types';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient()!;

  const { data, error } = await supabase
    .from('ingest_jobs')
    .select('id, total, done, failed, status, created_at, finished_at')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0003 first.' });
    }
    console.error('Load ingest job failed:', error);
    return NextResponse.json({ configured: true, error: 'Could not load the ingest job.' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ configured: true, error: 'Ingest job not found.' }, { status: 404 });
  }

  const job = data as Pick<IngestJobRow, 'id' | 'total' | 'done' | 'failed' | 'status' | 'created_at' | 'finished_at'>;
  return NextResponse.json({
    configured: true,
    job: {
      id: job.id,
      total: job.total,
      done: job.done,
      failed: job.failed,
      status: job.status,
      remaining: Math.max(job.total - job.done - job.failed, 0),
      createdAt: job.created_at,
      finishedAt: job.finished_at,
    },
  });
}
