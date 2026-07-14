// POST /api/offer/rollback { version }: re-saves an older version's content
// as a brand new version (source: 'edited'). History is never rewritten,
// same "restore" convention as PUT /api/verticals/[id]/playbook: the UI
// resends an older version's content, which lands as a new version on top.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { saveOfferEdit, validateOfferContent } from '@/lib/offer/store';

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' });
  }

  const body = await request.json().catch(() => null);
  const version =
    body && typeof body === 'object' ? Number((body as { version?: unknown }).version) : NaN;
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json(
      { configured: true, saved: false, reason: 'version must be a positive integer.' },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient()!;

  const { data, error } = await supabase
    .from('offer_versions')
    .select('content')
    .eq('version', version)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, saved: false, reason: 'Run migration 0014 first.' });
    }
    console.error('Load offer version for rollback failed:', error);
    return NextResponse.json({ configured: true, saved: false, reason: 'Could not load that version.' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ configured: true, saved: false, reason: 'Version not found.' }, { status: 404 });
  }

  // Re-validate the stored content before re-publishing it: a version
  // saved under an older contract could in theory predate a later required
  // field, and rolling back should never silently publish something that
  // would fail validation if a rep tried to save it fresh today.
  const validated = validateOfferContent((data as { content: unknown }).content);
  if (!validated.valid) {
    return NextResponse.json(
      { configured: true, saved: false, reason: `Stored version is invalid: ${validated.error}` },
      { status: 500 },
    );
  }

  const result = await saveOfferEdit(supabase, validated.content);
  if (!result.ok) {
    return NextResponse.json({ configured: true, saved: false, reason: result.reason }, { status: result.status });
  }

  return NextResponse.json({ configured: true, saved: true, version: result.version });
}
