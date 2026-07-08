// POST /api/verticals/[id]/generate — generates a fresh playbook for the
// vertical, stores it as the next playbook_versions row (source: generated),
// and bumps verticals.active_version. Answers 200s with a reason when
// Supabase or Claude env is missing, never 500 on missing config.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { isClaudeConfigured } from '@/lib/claude';
import { generatePlaybook } from '@/lib/playbook/generate';
import { publishPlaybookVersion } from '@/lib/playbook/versions';
import type { VerticalRow } from '@/lib/playbook/types';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, generated: false, reason: 'Supabase not configured.' });
  }
  if (!isClaudeConfigured()) {
    return NextResponse.json({ configured: true, generated: false, reason: 'Claude not configured.' });
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient()!;

  const { data: verticalData, error: verticalError } = await supabase
    .from('verticals')
    .select('id, name, description, knowledge_notes')
    .eq('id', id)
    .maybeSingle();

  if (verticalError) {
    console.error('Load vertical for generate failed:', verticalError);
    return NextResponse.json(
      { configured: true, generated: false, reason: 'Could not load vertical.' },
      { status: 500 },
    );
  }
  if (!verticalData) {
    return NextResponse.json(
      { configured: true, generated: false, reason: 'Vertical not found.' },
      { status: 404 },
    );
  }
  // active_version is no longer read here — publishPlaybookVersion re-reads
  // it fresh itself (and retries on a collision), so a stale copy from this
  // earlier fetch could never be trusted for computing the next version
  // anyway.
  const vertical = verticalData as Pick<VerticalRow, 'id' | 'name' | 'description' | 'knowledge_notes'>;

  // Knowledge documents (Phase 1.5) are optional grounding, not a hard
  // requirement to generate — a missing 0003 migration (isMissingTableError)
  // or any other read error degrades to "no documents" rather than failing
  // generation; only an unexpected error is logged.
  const { data: documentRows, error: documentsError } = await supabase
    .from('documents')
    .select('title, content, created_at')
    .eq('vertical_id', id)
    .order('created_at', { ascending: true });
  if (documentsError && !isMissingTableError(documentsError)) {
    console.error('Load documents for generate failed:', documentsError);
  }
  const documents = (documentRows ?? []) as { title: string; content: string }[];

  let playbook;
  try {
    playbook = await generatePlaybook({
      name: vertical.name,
      description: vertical.description,
      knowledgeNotes: vertical.knowledge_notes,
      documents,
    });
  } catch (err) {
    console.error('Playbook generation failed:', err);
    return NextResponse.json(
      { configured: true, generated: false, reason: 'Playbook generation failed.' },
      { status: 502 },
    );
  }

  // publishPlaybookVersion re-reads active_version fresh and retries once on
  // a version-number collision — a full Claude-generated playbook that just
  // took several seconds must not be thrown away because a distill/edit
  // published in between (the H6 review finding).
  const result = await publishPlaybookVersion(supabase, id, 'generated', () => ({ ok: true, playbook }));
  if (!result.ok) {
    return NextResponse.json({ configured: true, generated: false, reason: result.reason }, { status: result.status });
  }

  return NextResponse.json({ configured: true, generated: true, playbook, version: result.version });
}
