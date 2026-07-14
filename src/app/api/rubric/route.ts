// GET /api/rubric — the active rubric (or a specific ?version=N) plus its
// version history. POST /api/rubric — validates and saves a full
// RubricContent as the next version (source: edited); also how "restore this
// version" works (the UI resends an older version's content here, landing
// as a brand new edited version — history is never rewritten). Same shape
// as GET/PUT /api/verticals/[id] and PUT /api/verticals/[id]/playbook, just
// without a per-vertical id since the rubric is a single global document.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getActiveRubric, saveRubricEdit } from '@/lib/scoring/rubric';
import type { RubricVersionRow } from '@/lib/scoring/types';

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const supabase = getSupabaseServerClient()!;

  const { data: historyData, error: historyError } = await supabase
    .from('rubric_versions')
    .select('version, source, created_at')
    .order('version', { ascending: false });
  if (historyError) {
    if (isMissingTableError(historyError)) {
      return NextResponse.json({ configured: true, reason: 'Run migration 0008 first.' });
    }
    console.error('Load rubric history failed:', historyError);
    return NextResponse.json({ configured: true, error: 'Could not load rubric history.' }, { status: 500 });
  }
  const history = (historyData ?? []) as Pick<RubricVersionRow, 'version' | 'source' | 'created_at'>[];

  const requestedVersionParam = new URL(request.url).searchParams.get('version');

  if (requestedVersionParam) {
    const requestedVersion = Number(requestedVersionParam);
    const { data: versionData, error: versionError } = await supabase
      .from('rubric_versions')
      .select('content, source')
      .eq('version', requestedVersion)
      .maybeSingle();
    if (versionError) {
      console.error('Load rubric version failed:', versionError);
      return NextResponse.json({ configured: true, error: 'Could not load rubric version.' }, { status: 500 });
    }
    if (!versionData) {
      return NextResponse.json({ configured: true, error: 'Version not found.' }, { status: 404 });
    }
    const version = versionData as Pick<RubricVersionRow, 'content' | 'source'>;
    return NextResponse.json({
      configured: true,
      rubric: version.content,
      version: requestedVersion,
      source: version.source,
      history: history.map(h => ({ version: h.version, source: h.source, createdAt: h.created_at })),
    });
  }

  const active = await getActiveRubric(supabase);
  if (!active.ok) {
    if (active.missingTable) {
      return NextResponse.json({ configured: true, reason: 'Run migration 0008 first.' });
    }
    return NextResponse.json({ configured: true, error: active.reason }, { status: 500 });
  }

  return NextResponse.json({
    configured: true,
    rubric: active.content,
    version: active.version,
    source: active.source,
    history: history.map(h => ({ version: h.version, source: h.source, createdAt: h.created_at })),
  });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' });
  }

  const body = await request.json().catch(() => null);
  const supabase = getSupabaseServerClient()!;

  const result = await saveRubricEdit(supabase, body);
  if (!result.ok) {
    return NextResponse.json({ configured: true, saved: false, reason: result.reason }, { status: result.status });
  }

  return NextResponse.json({ configured: true, saved: true, version: result.version });
}
