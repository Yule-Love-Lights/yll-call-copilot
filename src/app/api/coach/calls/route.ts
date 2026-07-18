// GET /api/coach/calls -- newest-first list of scored calls for the owner's
// call-review browser (/coach/calls): read a rep's transcript next to the
// full scorecard to prep a one-on-one. Reps never see this list -- same
// role gate as GET /api/digest (copied exactly): a rep gets a friendly 403
// before any call_scores/transcripts query runs. ?limit= (default 50, max
// 200) and ?before= page through the history.
//
// ?before= is a "scoredAt~id" pair cursor (see lib/coachCalls/cursor.ts):
// ordering purely on scored_at broke when batch scoring wrote two or more
// rows with the exact same timestamp -- a plain scored_at.lt filter could
// silently skip a tied row once it fell on a page boundary. Rows are now
// ordered (scored_at desc, id desc) and the cursor carries both fields so
// ties break on id instead of vanishing. A bare timestamp cursor (no "~",
// the pre-fix shape) is still accepted for backward compatibility.
//
// Two queries, not a join -- call_scores and transcripts are separate
// tables (0007/0008 migrations); loading the small page of call_scores rows
// first, then the matching transcripts by id, is simpler than a view and
// cheap at this scale (same "two queries are fine" call GET /api/scores
// already makes).

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import { resolveStaffRole } from '@/lib/auth/role';
import { buildBeforeFilter, parseCursor } from '@/lib/coachCalls/cursor';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(raw: string | null): number {
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

type ScoreRow = {
  id: string;
  transcript_id: string;
  rep_email: string | null;
  vertical_slug: string | null;
  called_at: string | null;
  scored_at: string;
  overall: number;
  experience_score: number;
  fix: unknown;
};

type TranscriptRow = {
  id: string;
  customer_name: string | null;
  outcome: string | null;
  duration_seconds: number | null;
};

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, calls: [] });
  }

  const supabase = getSupabaseServerClient()!;
  const role = await resolveStaffRole(supabase, await getSessionEmail());
  if (role === 'rep') {
    return NextResponse.json(
      { configured: true, error: "Call review is for the coach's one-on-one prep, not a rep-facing page." },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const limit = clampLimit(url.searchParams.get('limit'));
  const before = url.searchParams.get('before');

  let query = supabase
    .from('call_scores')
    .select('id, transcript_id, rep_email, vertical_slug, called_at, scored_at, overall, experience_score, fix')
    .order('scored_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (before) query = query.or(buildBeforeFilter(parseCursor(before)));

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0008 first.', calls: [] });
    }
    console.error('Load call scores for call review failed:', error);
    return NextResponse.json({ configured: true, error: 'Could not load calls.', calls: [] }, { status: 500 });
  }

  const scoreRows = (data ?? []) as ScoreRow[];
  const transcriptIds = scoreRows.map(r => r.transcript_id);
  const transcriptById = new Map<string, TranscriptRow>();

  if (transcriptIds.length > 0) {
    const { data: transcriptRows, error: transcriptError } = await supabase
      .from('transcripts')
      .select('id, customer_name, outcome, duration_seconds')
      .in('id', transcriptIds);
    if (transcriptError) {
      console.error('Load transcripts for call review failed:', transcriptError);
      return NextResponse.json({ configured: true, error: 'Could not load calls.', calls: [] }, { status: 500 });
    }
    for (const t of (transcriptRows ?? []) as TranscriptRow[]) {
      transcriptById.set(t.id, t);
    }
  }

  const calls = scoreRows.map(r => {
    const t = transcriptById.get(r.transcript_id);
    return {
      id: r.id,
      transcript_id: r.transcript_id,
      rep_email: r.rep_email,
      vertical_slug: r.vertical_slug,
      called_at: r.called_at,
      scored_at: r.scored_at,
      overall: r.overall,
      experience_score: r.experience_score,
      praise_only: r.fix === null,
      customer_name: t?.customer_name ?? null,
      duration_seconds: t?.duration_seconds ?? null,
      outcome: t?.outcome ?? 'unknown',
    };
  });

  return NextResponse.json({ configured: true, calls });
}
