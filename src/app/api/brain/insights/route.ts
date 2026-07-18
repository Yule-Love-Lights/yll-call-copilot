// GET/POST /api/brain/insights -- the manual half of "Seed the Brain" (Wave
// 1 PR B). GET lists insights, newest first, optionally filtered by
// ?lens= and/or ?vertical= (a sibling PR's Brain view reads the same
// table by lens the same way). POST inserts one manual insight (source
// must be 'manual' -- 'interview' rows only ever come from
// POST /api/brain/interview's distillation). Degrades on missing table the
// same way every other route in this app does; created_by is best-effort
// (attribution only, never gates the write -- the staff session itself is
// already required by src/proxy.ts before this route is ever reached).

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import { isInsightLens, type BrainInsightRow } from '@/lib/brain/types';

function serialize(row: BrainInsightRow) {
  return {
    id: row.id,
    verticalId: row.vertical_id,
    source: row.source,
    lens: row.lens,
    title: row.title,
    content: row.content,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, insights: [] });
  }

  const supabase = getSupabaseServerClient()!;
  const url = new URL(request.url);
  const lens = url.searchParams.get('lens');
  const verticalId = url.searchParams.get('vertical');

  let query = supabase
    .from('brain_insights')
    .select('id, vertical_id, source, lens, title, content, created_by, created_at')
    .order('created_at', { ascending: false });
  if (lens) query = query.eq('lens', lens);
  if (verticalId) query = query.eq('vertical_id', verticalId);

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, migrated: false, insights: [], reason: 'Run migration 0015 first.' });
    }
    console.error('List brain insights failed:', error);
    return NextResponse.json({ configured: true, insights: [], error: 'Could not load insights.' }, { status: 500 });
  }

  const rows = (data ?? []) as BrainInsightRow[];
  return NextResponse.json({ configured: true, insights: rows.map(serialize) });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const b = body ?? {};

  if (b.source !== 'manual') {
    return NextResponse.json({ configured: true, saved: false, reason: "source must be 'manual'." }, { status: 400 });
  }
  if (!isInsightLens(b.lens)) {
    return NextResponse.json(
      { configured: true, saved: false, reason: 'lens must be one of market|leads|coaching|general.' },
      { status: 400 },
    );
  }
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  const content = typeof b.content === 'string' ? b.content.trim() : '';
  if (!title || !content) {
    return NextResponse.json({ configured: true, saved: false, reason: 'title and content are required.' }, { status: 400 });
  }
  const verticalId = typeof b.vertical_id === 'string' && b.vertical_id.trim() ? b.vertical_id.trim() : null;

  const supabase = getSupabaseServerClient()!;
  const createdBy = await getSessionEmail();

  const { data, error } = await supabase
    .from('brain_insights')
    .insert({ vertical_id: verticalId, source: 'manual', lens: b.lens, title, content, created_by: createdBy })
    .select('id, vertical_id, source, lens, title, content, created_by, created_at')
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, saved: false, reason: 'Run migration 0015 first.' });
    }
    console.error('Store brain insight failed:', error);
    return NextResponse.json({ configured: true, saved: false, reason: 'Could not save the insight.' }, { status: 500 });
  }

  return NextResponse.json({ configured: true, saved: true, insight: serialize(data as BrainInsightRow) });
}
