// GET /api/offer: the active offer content (highest version), plus the
// version history. POST /api/offer: validates a full OfferContent and
// stores it as the next version (source: 'edited'), mirroring PUT
// /api/verticals/[id]/playbook. Staff session, gated by the app's normal
// proxy auth like every other route here, no extra auth check needed.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { DEFAULT_OFFER_CONTENT, saveOfferEdit, validateOfferContent } from '@/lib/offer/store';
import type { OfferVersionRow } from '@/lib/offer/store';

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, content: DEFAULT_OFFER_CONTENT, version: null, source: null, history: [] });
  }

  const supabase = getSupabaseServerClient()!;
  const { data, error } = await supabase
    .from('offer_versions')
    .select('version, content, source, created_at')
    .order('version', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({
        configured: true,
        migrated: false,
        reason: 'Run migration 0014 first.',
        content: DEFAULT_OFFER_CONTENT,
        version: null,
        source: null,
        history: [],
      });
    }
    console.error('Load offer failed:', error);
    return NextResponse.json({ configured: true, error: 'Could not load the offer.' }, { status: 500 });
  }

  const rows = (data ?? []) as Pick<OfferVersionRow, 'version' | 'content' | 'source' | 'created_at'>[];
  if (rows.length === 0) {
    return NextResponse.json({ configured: true, content: DEFAULT_OFFER_CONTENT, version: null, source: null, history: [] });
  }

  const active = rows[0];
  return NextResponse.json({
    configured: true,
    content: active.content,
    version: active.version,
    source: active.source,
    history: rows.map(r => ({ version: r.version, source: r.source, createdAt: r.created_at })),
  });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' });
  }

  const body = await request.json().catch(() => null);
  const validated = validateOfferContent(body);
  if (!validated.valid) {
    return NextResponse.json({ configured: true, saved: false, reason: validated.error }, { status: 400 });
  }

  const supabase = getSupabaseServerClient()!;
  const result = await saveOfferEdit(supabase, validated.content);
  if (!result.ok) {
    return NextResponse.json({ configured: true, saved: false, reason: result.reason }, { status: result.status });
  }

  return NextResponse.json({ configured: true, saved: true, version: result.version });
}
