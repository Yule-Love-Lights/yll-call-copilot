// PUT /api/verticals/[id]/playbook — stores a full Playbook JSON as the next
// version (source: edited) and bumps verticals.active_version. Used both for
// direct edits and for "restore this version" (the UI resends an older
// version's content here, which lands as a brand new edited version — history
// is never rewritten).

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { validatePlaybook } from '@/lib/playbook/validate';
import type { VerticalRow } from '@/lib/playbook/types';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const result = validatePlaybook(body);
  if (!result.valid) {
    return NextResponse.json({ configured: true, saved: false, reason: result.error }, { status: 400 });
  }

  const supabase = getSupabaseServerClient()!;
  const { data: verticalData, error: verticalError } = await supabase
    .from('verticals')
    .select('id, active_version')
    .eq('id', id)
    .maybeSingle();

  if (verticalError) {
    console.error('Load vertical for playbook save failed:', verticalError);
    return NextResponse.json(
      { configured: true, saved: false, reason: 'Could not load vertical.' },
      { status: 500 },
    );
  }
  if (!verticalData) {
    return NextResponse.json({ configured: true, saved: false, reason: 'Vertical not found.' }, { status: 404 });
  }
  const vertical = verticalData as Pick<VerticalRow, 'id' | 'active_version'>;

  const nextVersion = vertical.active_version + 1;
  const { error: insertError } = await supabase
    .from('playbook_versions')
    .insert({ vertical_id: id, version: nextVersion, content: result.playbook, source: 'edited' });

  if (insertError) {
    console.error('Store edited playbook failed:', insertError);
    return NextResponse.json(
      { configured: true, saved: false, reason: 'Could not store the playbook.' },
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
      { configured: true, saved: false, reason: 'Could not activate the saved playbook.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ configured: true, saved: true, version: nextVersion });
}
