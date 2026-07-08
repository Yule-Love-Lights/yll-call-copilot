// PUT /api/verticals/[id]/playbook — stores a full Playbook JSON as the next
// version (source: edited) and bumps verticals.active_version. Used both for
// direct edits and for "restore this version" (the UI resends an older
// version's content here, which lands as a brand new edited version — history
// is never rewritten).

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { validatePlaybook } from '@/lib/playbook/validate';
import { publishPlaybookVersion } from '@/lib/playbook/versions';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const validated = validatePlaybook(body);
  if (!validated.valid) {
    return NextResponse.json({ configured: true, saved: false, reason: validated.error }, { status: 400 });
  }

  const supabase = getSupabaseServerClient()!;

  // publishPlaybookVersion does its own vertical lookup (404/500 as
  // appropriate) and retries once on a version-number collision with a
  // concurrent publish for the same vertical (the H6 review finding).
  const result = await publishPlaybookVersion(supabase, id, 'edited', () => ({ ok: true, playbook: validated.playbook }));
  if (!result.ok) {
    return NextResponse.json({ configured: true, saved: false, reason: result.reason }, { status: result.status });
  }

  return NextResponse.json({ configured: true, saved: true, version: result.version });
}
