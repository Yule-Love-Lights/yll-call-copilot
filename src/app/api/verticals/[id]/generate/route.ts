// POST /api/verticals/[id]/generate — generates a fresh playbook for the
// vertical, stores it as the next playbook_versions row (source: generated),
// and bumps verticals.active_version. Answers 200s with a reason when
// Supabase or Claude env is missing, never 500 on missing config.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { isClaudeConfigured } from '@/lib/claude';
import { generatePlaybook } from '@/lib/playbook/generate';
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
    .select('id, name, description, knowledge_notes, active_version')
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
  const vertical = verticalData as Pick<
    VerticalRow,
    'id' | 'name' | 'description' | 'knowledge_notes' | 'active_version'
  >;

  let playbook;
  try {
    playbook = await generatePlaybook({
      name: vertical.name,
      description: vertical.description,
      knowledgeNotes: vertical.knowledge_notes,
    });
  } catch (err) {
    console.error('Playbook generation failed:', err);
    return NextResponse.json(
      { configured: true, generated: false, reason: 'Playbook generation failed.' },
      { status: 502 },
    );
  }

  const nextVersion = vertical.active_version + 1;
  const { error: insertError } = await supabase
    .from('playbook_versions')
    .insert({ vertical_id: id, version: nextVersion, content: playbook, source: 'generated' });

  if (insertError) {
    console.error('Store generated playbook failed:', insertError);
    return NextResponse.json(
      { configured: true, generated: false, reason: 'Could not store the generated playbook.' },
      { status: 500 },
    );
  }

  const { error: updateError } = await supabase
    .from('verticals')
    .update({ active_version: nextVersion })
    .eq('id', id);

  if (updateError) {
    console.error('Bump active_version failed:', updateError);
    return NextResponse.json(
      { configured: true, generated: false, reason: 'Could not activate the generated playbook.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ configured: true, generated: true, playbook, version: nextVersion });
}
