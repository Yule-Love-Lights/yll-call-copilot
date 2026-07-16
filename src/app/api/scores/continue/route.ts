// POST /api/scores/continue — on-demand counterpart to the nightly cron
// (GET /api/cron/score-calls): scores the next batch of up to BATCH_LIMIT
// unscored substantive transcripts, newest first, best-effort per
// transcript. Staff-only like every other non-public route (gated by
// src/proxy.ts, no extra check needed here). A caller wanting to clear a
// bigger backlog just calls this repeatedly -- same "loop it from the UI"
// shape as POST /api/ingest/continue, without a job table since scoring is
// stateless (see batch.ts's own comment on why).

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { isClaudeConfigured } from '@/lib/claude';
import { scoreNextBatch } from '@/lib/scoring/batch';

export const maxDuration = 300;

const BATCH_LIMIT = 8;

export async function POST() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, reason: 'Supabase not configured.' });
  }
  if (!isClaudeConfigured()) {
    return NextResponse.json({ configured: true, reason: 'Claude not configured.' });
  }

  const supabase = getSupabaseServerClient()!;

  try {
    const result = await scoreNextBatch(supabase, BATCH_LIMIT);
    return NextResponse.json({ configured: true, ...result });
  } catch (err) {
    if (isMissingTableError(err)) {
      return NextResponse.json({ configured: true, reason: 'Run migration 0008 first.' });
    }
    console.error('Score batch failed:', err);
    return NextResponse.json({ configured: true, reason: 'Scoring batch failed.' }, { status: 500 });
  }
}
