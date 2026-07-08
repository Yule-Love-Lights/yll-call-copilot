// GET /api/verticals/[id] — the vertical, its active playbook (or a specific
// ?version=N), and the version history. PUT /api/verticals/[id] — updates
// description / knowledgeNotes / seasonWindow only (metadata, not the
// playbook content itself — that's PUT /api/verticals/[id]/playbook).

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { isClaudeConfigured } from '@/lib/claude';
import type { PlaybookVersionRow, VerticalRow } from '@/lib/playbook/types';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient()!;

  const { data: verticalData, error: verticalError } = await supabase
    .from('verticals')
    .select('id, slug, name, description, knowledge_notes, season_window, active_version, created_at')
    .eq('id', id)
    .maybeSingle();

  if (verticalError) {
    console.error('Load vertical failed:', verticalError);
    return NextResponse.json({ configured: true, error: 'Could not load vertical.' }, { status: 500 });
  }
  if (!verticalData) {
    return NextResponse.json({ configured: true, error: 'Vertical not found.' }, { status: 404 });
  }
  const vertical = verticalData as VerticalRow;

  const { data: historyData, error: historyError } = await supabase
    .from('playbook_versions')
    .select('version, source, created_at')
    .eq('vertical_id', id)
    .order('version', { ascending: false });

  if (historyError) {
    console.error('Load playbook history failed:', historyError);
    return NextResponse.json(
      { configured: true, error: 'Could not load playbook history.' },
      { status: 500 },
    );
  }

  const requestedVersionParam = new URL(request.url).searchParams.get('version');
  const requestedVersion = requestedVersionParam ? Number(requestedVersionParam) : vertical.active_version;

  let playbook = null;
  let source = null;
  if (requestedVersion > 0) {
    const { data: versionData, error: versionError } = await supabase
      .from('playbook_versions')
      .select('content, source')
      .eq('vertical_id', id)
      .eq('version', requestedVersion)
      .maybeSingle();

    if (versionError) {
      console.error('Load playbook version failed:', versionError);
      return NextResponse.json(
        { configured: true, error: 'Could not load playbook version.' },
        { status: 500 },
      );
    }
    if (!versionData) {
      return NextResponse.json({ configured: true, error: 'Version not found.' }, { status: 404 });
    }
    const version = versionData as Pick<PlaybookVersionRow, 'content' | 'source'>;
    playbook = version.content;
    source = version.source;
  }

  return NextResponse.json({
    configured: true,
    claudeConfigured: isClaudeConfigured(),
    vertical: {
      id: vertical.id,
      slug: vertical.slug,
      name: vertical.name,
      description: vertical.description,
      knowledgeNotes: vertical.knowledge_notes,
      seasonWindow: vertical.season_window,
      activeVersion: vertical.active_version,
      createdAt: vertical.created_at,
    },
    playbook,
    version: requestedVersion > 0 ? requestedVersion : null,
    source,
    history: (historyData ?? []).map(h => ({ version: h.version, source: h.source, createdAt: h.created_at })),
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ configured: true, error: 'Invalid request body.' }, { status: 400 });
  }

  const update: Record<string, string | null> = {};
  if (typeof body.description === 'string') update.description = body.description;
  if (typeof body.knowledgeNotes === 'string') update.knowledge_notes = body.knowledgeNotes;
  if ('seasonWindow' in body) {
    update.season_window = typeof body.seasonWindow === 'string' ? body.seasonWindow : null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ configured: true, error: 'No updatable fields provided.' }, { status: 400 });
  }

  const supabase = getSupabaseServerClient()!;
  const { data, error } = await supabase
    .from('verticals')
    .update(update)
    .eq('id', id)
    .select('id, slug, name, description, knowledge_notes, season_window, active_version, created_at')
    .maybeSingle();

  if (error) {
    console.error('Update vertical failed:', error);
    return NextResponse.json({ configured: true, error: 'Could not update vertical.' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ configured: true, error: 'Vertical not found.' }, { status: 404 });
  }

  const vertical = data as VerticalRow;
  return NextResponse.json({
    configured: true,
    vertical: {
      id: vertical.id,
      slug: vertical.slug,
      name: vertical.name,
      description: vertical.description,
      knowledgeNotes: vertical.knowledge_notes,
      seasonWindow: vertical.season_window,
      activeVersion: vertical.active_version,
      createdAt: vertical.created_at,
    },
  });
}
